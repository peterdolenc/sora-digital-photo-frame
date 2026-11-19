const request = require('supertest');
const path = require('path');
const fs = require('fs-extra');
const sharp = require('sharp');

// Point the app at throwaway folders before it loads
const testUploadsDir = path.join(__dirname, 'robust-uploads');
const testCacheDir = path.join(__dirname, 'robust-cache');
const testDataDir = path.join(__dirname, 'robust-data');
process.env.UPLOAD_DIR = testUploadsDir;
process.env.CACHE_DIR = testCacheDir;
process.env.DATA_DIR = testDataDir;
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
process.env.ADMIN_PASSWORD = 'test-admin-pass';

const LocalDataStore = require('../store/LocalDataStore');
const LocalPhotoLibrary = require('../library/LocalPhotoLibrary');
const { createApp } = require('../app');
const { setDataStore } = require('../store');
const photoInfo = require('../services/photoInfoService');

// A store that can break on demand, like a database going away
let storeDown = false;
class FlakyStore extends LocalDataStore {
  async get(name, fallback) {
    if (storeDown) throw new Error('store is down');
    return super.get(name, fallback);
  }
}

const app = createApp();
setDataStore(new FlakyStore());

describe('Robustness', () => {
  const admin = request.agent(app);
  const dataStore = new LocalDataStore();
  let png;
  let stored;

  beforeAll(async () => {
    await fs.ensureDir(path.join(testUploadsDir, 'family'));
    await admin.post('/api/auth/login').send({ password: 'test-admin-pass' }).expect(200);
    png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#c33' } }).png().toBuffer();

    const photo = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#36c' } })
      .jpeg()
      .withMetadata({ exif: { IFD2: { DateTimeOriginal: '2019:03:12 18:04:00' } } })
      .toBuffer();
    const res = await admin.post('/api/upload')
      .field('path', 'uploads/family')
      .attach('images', photo, 'IMG_0001.jpg')
      .expect(200);
    stored = res.body.files[0];
  });

  afterEach(() => {
    storeDown = false;
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await Promise.all([testUploadsDir, testCacheDir, testDataDir].map(dir => fs.remove(dir)));
  });

  describe('thumbnails', () => {
    test('are never stored by shared caches', async () => {
      const res = await admin.get('/api/folders/family/thumbnail').expect(200);
      expect(res.headers['cache-control']).toMatch(/^private/);
    });
  });

  describe('uploads', () => {
    const upload = count => {
      const req = admin.post('/api/upload').field('path', 'uploads/family');
      for (let i = 0; i < count; i += 1) req.attach('images', png, `p${i}.png`);
      return req;
    };

    test('accept 10 files in one request', async () => {
      const res = await upload(10).expect(200);
      expect(res.body.files).toHaveLength(10);
    });

    test('refuse more than 10 files in one request', async () => {
      const res = await upload(11).expect(400);
      expect(res.body.message).toMatch(/too many files/i);
    });
  });

  describe('when the store fails', () => {
    test('saved photo info is not replaced after a failed read', async () => {
      await dataStore.set('photo-info', { 'family/old.webp': { key: 'k', takenAt: '2001-01-01T00:00:00' } });
      const state = photoInfo.state();
      const kept = state.info;
      state.info = null;
      try {
        storeDown = true;
        await expect(photoInfo.loadCache()).rejects.toThrow('store is down');
        expect(state.info).toBeNull();
        storeDown = false;
        await photoInfo.loadCache();
        expect(state.info['family/old.webp'].takenAt).toBe('2001-01-01T00:00:00');
      } finally {
        state.info = kept; // other tests rely on what's been remembered so far
      }
    });
  });

  describe('captions', () => {
    const known = { takenAt: '2019-03-12T18:04:00', lat: 15.5, lon: 73.8 };

    beforeEach(() => {
      jest.spyOn(photoInfo, 'get').mockResolvedValue(known);
      jest.spyOn(photoInfo, 'placeName').mockResolvedValue('Panaji, India');
    });

    test('reach the frame without signing in', async () => {
      const res = await request(app).get('/api/images/random').expect(200);
      expect(res.body.image.info.place).toBe('Panaji, India');
    });

    test('reach a signed-in viewer', async () => {
      const { body } = await admin.get('/api/images/random').expect(200);
      expect(body.image.info).toEqual({ takenAt: known.takenAt, place: 'Panaji, India', caption: null, camera: null, lens: null, aperture: null, iso: null });
    });
  });

  describe('rotating a photo', () => {
    test('keeps its capture date (the stored copy has no EXIF)', async () => {
      await admin.post('/api/images/rotate').send({ path: stored.path, angle: 90 }).expect(200);
      const fullPath = path.join(testUploadsDir, 'family', path.basename(stored.path));
      const info = await photoInfo.get(fullPath, path.relative(testUploadsDir, fullPath));
      expect(info.takenAt).toBe('2019-03-12T18:04:00');
    });
  });

  describe('photo info', () => {
    test('is kept with durable data, not in the cache folder', async () => {
      await dataStore.set('photo-info', {});
      expect(await fs.pathExists(path.join(testDataDir, 'photo-info.json'))).toBe(true);
    });

    test('survives rotating a photo that was never viewed', async () => {
      const name = 'never-viewed.jpg';
      await sharp({ create: { width: 40, height: 30, channels: 3, background: '#3a6' } })
        .jpeg()
        .withMetadata({ exif: { IFD2: { DateTimeOriginal: '2015:06:01 09:30:00' } } })
        .toFile(path.join(testUploadsDir, 'family', name));
      await admin.post('/api/images/rotate').send({ path: `uploads/family/${name}`, angle: 90 }).expect(200);
      const fullPath = path.join(testUploadsDir, 'family', name);
      const info = await photoInfo.get(fullPath, path.relative(testUploadsDir, fullPath));
      expect(info.takenAt).toBe('2015-06-01T09:30:00');
    });
  });

  describe('listing a folder', () => {
    test('skips a file that disappears mid-listing', async () => {
      const folder = path.join(testUploadsDir, 'listing');
      await fs.ensureDir(folder);
      await fs.writeFile(path.join(folder, 'keep.jpg'), png);
      await fs.writeFile(path.join(folder, 'gone.tmp'), png);

      const realStat = fs.stat;
      jest.spyOn(fs, 'stat').mockImplementation((file, ...rest) => {
        if (String(file).endsWith('gone.tmp')) {
          return Promise.reject(Object.assign(new Error('gone'), { code: 'ENOENT' }));
        }
        return realStat(file, ...rest);
      });

      const { photos } = await new LocalPhotoLibrary().listFolder('uploads/listing');
      expect(photos.map(p => p.name)).toEqual(['keep.jpg']);
    });
  });
});
