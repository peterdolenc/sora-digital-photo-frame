const request = require('supertest');
const http = require('http');
const path = require('path');
const fs = require('fs-extra');
const sharp = require('sharp');

// Point the app at throwaway folders before it loads
const testUploadsDir = path.join(__dirname, 'control-uploads');
const testCacheDir = path.join(__dirname, 'control-cache');
const testDataDir = path.join(__dirname, 'control-data');
process.env.UPLOAD_DIR = testUploadsDir;
process.env.CACHE_DIR = testCacheDir;
process.env.DATA_DIR = testDataDir;
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
process.env.ADMIN_PASSWORD = 'test-admin-pass';
delete process.env.PHOTO_ENCRYPTION_KEY;

const { createApp } = require('../app');
const frame = require('../services/frameService');

describe('The server controls the frame', () => {
  const app = createApp();
  const admin = request.agent(app);
  let server;
  let base;

  // Reads the event stream until `count` events came in
  const listen = (count) => new Promise((resolve, reject) => {
    const events = [];
    let text = '';
    const req = http.get(`${base}/api/frame/events`, (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        text += chunk;
        const parts = text.split('\n\n');
        text = parts.pop();
        for (const part of parts) {
          const event = /^event: (.*)$/m.exec(part)?.[1];
          if (event) events.push({ event, data: JSON.parse(/^data: (.*)$/m.exec(part)[1]) });
        }
        if (events.length >= count) {
          req.destroy();
          resolve(events);
        }
      });
    });
    req.on('error', (error) => (error.code === 'ECONNRESET' ? null : reject(error)));
  });

  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  beforeAll(async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#c33' } }).png().toBuffer();
    for (const folder of ['family', 'trip']) {
      await fs.ensureDir(path.join(testUploadsDir, folder));
      await fs.writeFile(path.join(testUploadsDir, folder, `${folder}.png`), png);
    }
    await admin.post('/api/auth/login').send({ password: 'test-admin-pass' }).expect(200);
    await admin.post('/api/access-accounts').send({ name: 'Family', pin: '482913', assignedFolders: ['family'] }).expect(201);
    await admin.post('/api/access-accounts').send({ name: 'Trip', pin: '739104', assignedFolders: ['trip'] }).expect(201);
    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
    await Promise.all([testUploadsDir, testCacheDir, testDataDir].map(dir => fs.remove(dir)));
  });

  const shownFolder = async () => (await request(app).get('/api/images/random').expect(200)).body.image.folder;

  test('with nothing remembered it plays the first account', async () => {
    const { body } = await request(app).get('/api/control/state').expect(200);
    expect(body.accountName).toBe('Family');
    expect(body.accounts.map(a => a.name)).toEqual(['Family', 'Trip']);
    expect(await shownFolder()).toBe('family');
  });

  test('switching account by name changes the photos, and is remembered', async () => {
    await request(app).get('/api/control/account/trip').expect(200);
    expect(await shownFolder()).toBe('trip');

    // A fresh service (a restart) reads the remembered account from storage
    frame.invalidate();
    expect((await request(app).get('/api/control/state').expect(200)).body.accountName).toBe('Trip');
  });

  test('an unknown account is refused and nothing changes', async () => {
    const res = await request(app).get('/api/control/account/nobody').expect(404);
    expect(res.body.code).toBe('ACCOUNT_NOT_FOUND');
    expect((await request(app).get('/api/control/state').expect(200)).body.accountName).toBe('Trip');
  });

  test('the admin is not limited by the account being played', async () => {
    const { body } = await admin.get('/api/folders').expect(200);
    expect(body.folders.map(f => f.name).sort()).toEqual(['family', 'trip']);
    const limited = await request(app).get('/api/folders').expect(200);
    expect(limited.body.folders.map(f => f.name)).toEqual(['trip']);
  });

  test('an open frame hears the current account, then next, info and account changes', async () => {
    const heard = listen(4);
    await wait(150); // the stream is open and has sent its state
    expect((await request(app).get('/api/control/next').expect(200)).body.frames).toBe(1);
    expect((await request(app).get('/api/control/info/7').expect(200)).body.frames).toBe(1);
    await request(app).get('/api/control/account/Family').expect(200);

    const events = await heard;
    expect(events.map(e => e.event)).toEqual(['state', 'next', 'info', 'account']);
    expect(events[0].data.accountName).toBe('Trip');
    expect(events[2].data).toEqual({ seconds: 7 });
    expect(events[3].data.accountName).toBe('Family');
  });

  test('commands work with no frame connected, and bad seconds are refused', async () => {
    await wait(50);
    expect((await request(app).get('/api/control/next').expect(200)).body.frames).toBe(0);
    await request(app).get('/api/control/info/0').expect(400);
    await request(app).get('/api/control/info/soon').expect(400);
  });
});
