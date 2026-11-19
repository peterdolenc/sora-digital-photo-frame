const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
const session = require('express-session');

const logger = require('./middleware/logger');
const errorHandler = require('./middleware/errorHandler');
const webpFallback = require('./middleware/webpFallback');
const media = require('./middleware/media');
const sameOrigin = require('./middleware/sameOrigin');
const activeAccount = require('./middleware/activeAccount');
const { requireVisiblePhoto } = require('./utils/viewerAccess');
const EncryptedPhotoLibrary = require('./library/EncryptedPhotoLibrary');
const EncryptedDataStore = require('./store/EncryptedDataStore');
const { keysFromEnv } = require('./crypto/keys');
const routes = require('./routes');
const { UPLOADS_DIR } = require('./config/paths');
const LocalPhotoLibrary = require('./library/LocalPhotoLibrary');
const { setLibrary } = require('./library');
const LocalDataStore = require('./store/LocalDataStore');
const { setDataStore } = require('./store');
const { announceAdminPassword } = require('./middleware/auth');
const { sessionSecret, announceSessionSecret } = require('./utils/sessionSecret');

/**
 * Build the photo frame app.
 *
 * Options:
 *   trustProxy    Express 'trust proxy' setting (default: TRUST_PROXY, else 1 = one proxy in front)
 *   keys          key provider ({ currentKey, getKey }, see crypto/keys.js) to encrypt photos
 *                 and data at rest (default: PHOTO_ENCRYPTION_KEY, or no encryption)
 */
function createApp({ trustProxy = process.env.TRUST_PROXY, keys = keysFromEnv() } = {}) {
  announceSessionSecret();
  const secret = sessionSecret();

  const app = express();
  let photoLibrary = new LocalPhotoLibrary();
  let store = new LocalDataStore();
  if (keys) {
    photoLibrary = new EncryptedPhotoLibrary(photoLibrary, keys);
    store = new EncryptedDataStore(store, keys);
  }
  setLibrary(photoLibrary);
  setDataStore(store);
  announceAdminPassword();

  // Which X-Forwarded-* headers to believe (client address, https). The default, 1,
  // fits one reverse proxy in front. With nothing in front, set TRUST_PROXY=false,
  // so nobody can pick their own address by sending the header.
  app.set('trust proxy', trustProxySetting(trustProxy));

  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use(session({
    secret,
    resave: false,
    saveUninitialized: false,
    name: 'photoframe.sid', // Custom session cookie name
    cookie: {
      secure: false, // Set to false for development, even in production for HTTP
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: 'lax' // Add SameSite attribute for better compatibility
    }
  }));

  app.use(logger);
  // Changes only from this site's own pages (see middleware/sameOrigin)
  app.use(sameOrigin);
  // The account being played decides which photos are shown
  app.use('/api', activeAccount.invalidateOnChange);
  app.use(['/api/random-image', '/api/images', '/api/folders', '/api/notes', '/uploads'], activeAccount);

  // Static files
  if (photoLibrary.staticDir) {
    app.use('/uploads', requireVisiblePhoto, webpFallback(photoLibrary.staticDir), express.static(photoLibrary.staticDir));
  } else {
    // Encrypted or remote storage: serve through the library (decrypts on the server)
    app.use('/uploads', requireVisiblePhoto, media());
  }
  app.use('/js', express.static(path.join(__dirname, 'public/js')));
  app.use('/admin', express.static(path.join(__dirname, 'public')));
  // Serve CSS and JS files from root for access-accounts page
  app.use(express.static(path.join(__dirname, 'public'), {
    index: false // Prevent serving index.html from root
  }));

  // Browsers ask for /favicon.ico on their own
  app.get('/favicon.ico', (req, res) => res.sendFile(path.join(__dirname, 'public/icons/favicon.ico')));

  app.use('/', routes);

  // Error handling middleware (must be last)
  app.use(errorHandler);

  return app;
}

// TRUST_PROXY: "false"/"true", a number of proxies, or addresses Express understands
function trustProxySetting(value) {
  if (value === undefined || value === null || value === '') return 1;
  if (typeof value !== 'string') return value;
  if (value === 'false') return false;
  if (value === 'true') return true;
  return /^\d+$/.test(value) ? Number(value) : value;
}

// Create the uploads folder and the default photo folders
async function initializeUploads() {
  const defaultFolders = (process.env.DEFAULT_FOLDERS || 'family,vacation,holidays,misc').split(',');

  await fs.ensureDir(UPLOADS_DIR);

  for (const folder of defaultFolders) {
    await fs.ensureDir(path.join(UPLOADS_DIR, folder.trim()));
  }
}

module.exports = { createApp, initializeUploads };
