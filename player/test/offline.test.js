'use strict';
// Offline-Empfang: Kopplung, fortsetzbare Übertragung, Prüfsumme, Umschalten, Suche im Netz.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const dgram = require('node:dgram');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Config } = require('../src/config');
const { OfflineReceiver } = require('../src/offline');

const plain = { available: () => false, encrypt: (s) => Buffer.from(s), decrypt: (b) => b.toString() };
const log = { info() {}, warn() {}, error() {} };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

let dir;
let config;
let rx;
let base;
let token;
const video = crypto.randomBytes(300000);
const image = crypto.randomBytes(5000);
const fileOf = (id, buf, ext, mime) => ({ id, path: `media/${sha(buf)}.${ext}`, size: buf.length, sha256: sha(buf), mime });
const files = [fileOf('f1', video, 'mp4', 'video/mp4'), fileOf('f2', image, 'png', 'image/png')];
const manifest = (revision) => ({
  schemaVersion: 1,
  revision,
  publishedAt: new Date().toISOString(),
  layout: { schemaVersion: 1, format: { orientation: 'landscape', width: 1920, height: 1080 }, pages: [{ id: 'home', elements: [{ id: 't', type: 'thumbnail', x: 0, y: 0, w: 10, h: 10, video: 'f1', poster: 'f2' }] }] },
  files,
});

const call = (method, p, body, headers = {}) => fetch(base + p, {
  method,
  headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}), ...headers },
  body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined,
});

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plinth-offline-'));
  config = new Config(dir, plain);
  rx = new OfflineReceiver({ dataDir: dir, config, log, version: '9.9.9', port: 0, discoveryPort: 0 });
  rx.port = 0;
  await rx.start();
  rx.port = rx.server.address().port;
  base = `http://127.0.0.1:${rx.port}`;
});

after(() => {
  rx.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Identität und Kopplungscode werden beim ersten Start erzeugt', () => {
  assert.match(config.get('pairCode'), /^\d{6}$/);
  assert.match(config.get('deviceId'), /^[0-9a-f-]{36}$/);
});

test('Info ist öffentlich, alles andere braucht Kopplung', async () => {
  const info = await (await call('GET', '/plinth/v1/info')).json();
  assert.equal(info.app, 'plinth-player');
  assert.equal(info.paired, false);
  assert.equal((await call('POST', '/plinth/v1/pruefen', { files })).status, 401);
});

test('Falscher Code wird abgelehnt, richtiger koppelt und übernimmt Name und PIN', async () => {
  assert.equal((await call('POST', '/plinth/v1/koppeln', { code: '000000' === config.get('pairCode') ? '111111' : '000000' })).status, 403);
  const res = await call('POST', '/plinth/v1/koppeln', { code: config.get('pairCode'), studio: 'Test-Studio', studioId: 's1', name: 'Foyer', pin: '4711' });
  assert.equal(res.status, 200);
  const data = await res.json();
  token = data.token;
  assert.equal(data.name, 'Foyer');
  assert.equal(data.paired, true);
  assert.ok(config.checkPin('4711'));
  assert.equal(JSON.stringify(config.data).includes(token), false, 'Token nur als Hash gespeichert');
});

test('Aktivieren ohne Dateien wird abgelehnt', async () => {
  const res = await call('POST', '/plinth/v1/aktivieren', { manifest: manifest(1), projekt: { id: 1, name: 'P' } });
  assert.equal(res.status, 409);
});

test('Übertragung ist fortsetzbar und wird per SHA-256 geprüft', async () => {
  const name = path.basename(files[0].path);
  let res = await call('POST', '/plinth/v1/pruefen', { files });
  assert.deepEqual((await res.json()).missing.map((m) => m.offset), [0, 0]);

  // erster Teil
  res = await call('PUT', `/plinth/v1/medien/${name}?offset=0`, new Uint8Array(video.subarray(0, 100000)), { 'X-Plinth-Size': String(video.length) });
  assert.deepEqual(await res.json(), { offset: 100000, complete: false });
  // falscher Startpunkt → 409 mit tatsächlichem Stand
  res = await call('PUT', `/plinth/v1/medien/${name}?offset=5`, new Uint8Array(video.subarray(5)), { 'X-Plinth-Size': String(video.length) });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).offset, 100000);
  // Prüfen meldet den Stand für die Fortsetzung
  res = await call('POST', '/plinth/v1/pruefen', { files });
  assert.equal((await res.json()).missing[0].offset, 100000);
  // Rest
  res = await call('PUT', `/plinth/v1/medien/${name}?offset=100000`, new Uint8Array(video.subarray(100000)), { 'X-Plinth-Size': String(video.length) });
  assert.deepEqual(await res.json(), { offset: video.length, complete: true });

  // Bild mit falschem Inhalt → verworfen
  const img = path.basename(files[1].path);
  const bad = Buffer.from(image);
  bad[0] ^= 0xff;
  res = await call('PUT', `/plinth/v1/medien/${img}?offset=0`, new Uint8Array(bad), { 'X-Plinth-Size': String(image.length) });
  assert.equal(res.status, 422);
  res = await call('PUT', `/plinth/v1/medien/${img}?offset=0`, new Uint8Array(image), { 'X-Plinth-Size': String(image.length) });
  assert.equal((await res.json()).complete, true);
});

test('Aktivieren schaltet um, neuer Stand ersetzt alten, Rückfall bleibt', async () => {
  const shown = [];
  rx.on('content', (m) => shown.push(m.revision));
  let res = await call('POST', '/plinth/v1/aktivieren', { manifest: manifest(1), projekt: { id: 7, name: 'Foyer' } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).projekt.revision, 1);
  res = await call('POST', '/plinth/v1/aktivieren', { manifest: manifest(2), projekt: { id: 7, name: 'Foyer' } });
  assert.equal(res.status, 200);
  assert.deepEqual(shown, [1, 2]);
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  assert.match(state.current, /-2$/);
  assert.match(state.previous, /-1$/);
  assert.equal(rx.store.playable().revision, 2);
});

test('Unsichere Pfade werden abgelehnt', async () => {
  const res = await call('PUT', '/plinth/v1/medien/..%2F..%2Fevil.exe?offset=0', new Uint8Array([1]), { 'X-Plinth-Size': '1' });
  assert.equal(res.status, 422);
  const m = manifest(3);
  m.files = [{ ...files[0], path: '../x.mp4' }];
  assert.equal((await call('POST', '/plinth/v1/aktivieren', { manifest: m })).status, 422);
});

test('Suche im Netz: Player antwortet auf UDP-Anfrage', async () => {
  const port = rx.udp.address().port;
  const sock = dgram.createSocket('udp4');
  const reply = new Promise((resolve) => sock.on('message', (msg) => resolve(JSON.parse(msg.toString()))));
  sock.send('PLINTH-SUCHE', port, '127.0.0.1');
  const info = await reply;
  sock.close();
  assert.equal(info.name, 'Foyer');
  assert.equal(info.deviceId, config.get('deviceId'));
});

test('Fünf falsche Codes sperren die Kopplung', async () => {
  const saved = token;
  token = null;
  for (let i = 0; i < 5; i++) await call('POST', '/plinth/v1/koppeln', { code: 'x' });
  assert.equal((await call('POST', '/plinth/v1/koppeln', { code: config.get('pairCode') })).status, 429);
  token = saved;
});
