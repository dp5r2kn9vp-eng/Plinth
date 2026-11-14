'use strict';
// Integrationstests der Sync-Engine gegen eine laufende Installation.
// PLINTH_URL=http://localhost:8099 node --test test/
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { SyncEngine } = require('../src/sync');
const { Studio, BASE } = require('./helpers');

const skip = !BASE && 'PLINTH_URL nicht gesetzt';
const log = { info() {}, warn() {}, error() {} };
let studio, projekt, device, bild, video, video2, rev1;

before(async () => {
  if (skip) return;
  studio = new Studio();
  await studio.login();
  projekt = await studio.project(`Sync-Test ${Date.now()}`);
  bild = await studio.upload('bild.png', 'image/png', crypto.randomBytes(20_000));
  video = await studio.upload('video.mp4', 'video/mp4', crypto.randomBytes(9 * 1024 * 1024)); // 2 Teile
  video2 = await studio.upload('video2.mp4', 'video/mp4', crypto.randomBytes(50_000));
  rev1 = await studio.publish(projekt.id, (l) => {
    l.pages[0].background = { color: '#000000', image: bild.ref, fit: 'cover' };
    l.pages[0].elements.push({ id: 'v', type: 'thumbnail', x: 0, y: 0, w: 800, h: 450, video: video.ref });
  });
  device = await studio.registerDevice('Sync-Test');
  const { geraete } = await studio.call('GET', '/geraete');
  await studio.call('PATCH', `/geraete/${geraete.find((g) => g.id === device.geraetId).id}`, { projektId: projekt.id });
});

const engine = (dir, extra = {}) => new SyncEngine({ dataDir: dir, apiUrl: `${BASE}/api`, token: () => device.token, log, pollSeconds: 3600, appVersion: '1.0.0-test', ...extra });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'plinth-sync-'));
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

test('Erster Start lädt alles, prüft Hashes, meldet Revision', { skip }, async () => {
  const dir = tmp();
  const e = engine(dir);
  const content = once(e, 'content');
  e.start();
  const [m] = await content;
  e.stop();
  assert.equal(m.revision, rev1.nummer);
  for (const f of m.files) assert.equal(sha(path.join(dir, 'media', path.basename(f.path))), f.sha256);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'tmp')), []);
  const { geraete } = await studio.call('GET', '/geraete');
  assert.equal(geraete.find((g) => g.id === device.geraetId).geladeneRevision, rev1.nummer);
});

test('Ohne Änderung: 304 und kein Download', { skip }, async () => {
  const dir = tmp();
  const calls = [];
  const e = engine(dir, { fetch: (u, i) => { calls.push(String(u)); return fetch(u, i); } });
  e.start();
  await once(e, 'content');
  e.stop();
  await e.checkNow(); // laufende Prüfung inkl. Statusmeldung abwarten
  calls.length = 0;
  await e.checkNow();
  assert.equal(calls.length, 1, 'nur die Revisionsabfrage');
  assert.equal(e.status.online, true);
});

test('Abgebrochener Download wird per Range fortgesetzt', { skip }, async () => {
  const dir = tmp();
  const first = engine(dir);
  first.start();
  const [m] = await once(first, 'content');
  first.stop();
  // Halbe Videodatei als .part zurücklegen, Rest löschen
  const vf = m.files.find((f) => f.id === video.ref);
  const media = path.join(dir, 'media', path.basename(vf.path));
  const part = path.join(dir, 'tmp', `${path.basename(vf.path)}.part`);
  fs.writeFileSync(part, fs.readFileSync(media).subarray(0, 4 * 1024 * 1024));
  fs.rmSync(media);

  const ranges = [];
  const { httpGet } = require('../src/sync');
  const e = engine(dir, { get: (u, h) => { if (h.Range) ranges.push(h.Range); return httpGet(u, h); } });
  await e.checkNow();
  assert.deepEqual(ranges, [`bytes=${4 * 1024 * 1024}-`]);
  assert.equal(sha(media), vf.sha256);
});

test('Falsche Daten werden verworfen, nächster Versuch klappt', { skip }, async () => {
  const dir = tmp();
  const first = engine(dir);
  first.start();
  const [m] = await once(first, 'content');
  first.stop();
  const bf = m.files.find((f) => f.id === bild.ref);
  const media = path.join(dir, 'media', path.basename(bf.path));
  fs.rmSync(media);
  fs.writeFileSync(path.join(dir, 'tmp', `${path.basename(bf.path)}.part`), Buffer.alloc(100, 1)); // falscher Anfang

  const e = engine(dir);
  await e.checkNow();
  assert.match(e.status.lastError, /Prüfsumme/);
  assert.equal(fs.existsSync(media), false);
  await e.checkNow();
  assert.equal(sha(media), bf.sha256);
  assert.equal(e.status.lastError, null);
});

test('Offline: zeigt den letzten Stand weiter', { skip }, async () => {
  const dir = tmp();
  const first = engine(dir);
  first.start();
  await once(first, 'content');
  first.stop();

  const e = engine(dir, { fetch: async () => { throw new TypeError('fetch failed'); } });
  const content = once(e, 'content');
  e.start();
  const [m] = await content;
  await e.checkNow();
  e.stop();
  assert.equal(m.revision, rev1.nummer);
  assert.equal(e.status.online, false);
});

test('Neue Revision: Umschalten erst nach vollständigem Download, Rückfall und Aufräumen', { skip }, async () => {
  const dir = tmp();
  const e = engine(dir);
  e.start();
  await once(e, 'content');
  e.stop();

  const rev2 = await studio.publish(projekt.id, (l) => {
    l.pages[0].elements[0].video = video2.ref;
  });
  const switched = once(e, 'content');
  await e.checkNow();
  const [m2] = await switched;
  assert.equal(m2.revision, rev2.nummer);
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json')));
  assert.deepEqual(state, { current: `${projekt.id}-${rev2.nummer}`, previous: `${projekt.id}-${rev1.nummer}` });

  // Datei der aktuellen Revision fehlt → Rückfall auf die vorige
  const v2 = m2.files.find((f) => f.id === video2.ref);
  fs.rmSync(path.join(dir, 'media', path.basename(v2.path)));
  assert.equal(e.playable().revision, rev1.nummer);

  // Dritte Revision: Dateien von Revision 1, die keiner mehr braucht, werden gelöscht
  const rev3 = await studio.publish(projekt.id, (l) => {
    l.pages[0].elements = [];
    l.pages[0].background = { color: '#111111' };
  });
  await e.checkNow();
  assert.equal(e.state().current, `${projekt.id}-${rev3.nummer}`);
  const media = fs.readdirSync(path.join(dir, 'media'));
  assert.ok(!media.includes(path.basename(m2.files.find((f) => f.id === video.ref)?.path ?? 'x')), 'altes Video entfernt');
  assert.deepEqual(fs.readdirSync(path.join(dir, 'manifests')).sort(), [`${projekt.id}-${rev2.nummer}.json`, `${projekt.id}-${rev3.nummer}.json`].sort());
});

test('Wechsel auf ein anderes Projekt mit gleicher Revisionsnummer wird erkannt', { skip }, async () => {
  const dir = tmp();
  const e = engine(dir);
  e.start();
  await once(e, 'content');
  e.stop();
  await e.checkNow();

  const anderes = await studio.project(`Anderes ${Date.now()}`);
  const r = await studio.publish(anderes.id, (l) => {
    l.pages[0].elements.push({ id: 't', type: 'text', x: 0, y: 0, w: 100, h: 100, text: 'Anderes Projekt' });
  });
  assert.equal(r.nummer, 1);
  await studio.call('PATCH', `/geraete/${device.geraetId}`, { projektId: anderes.id });
  const switched = once(e, 'content');
  await e.checkNow();
  const [m] = await switched;
  assert.equal(m.layout.pages[0].elements[0].text, 'Anderes Projekt');
  await studio.call('PATCH', `/geraete/${device.geraetId}`, { projektId: projekt.id });
});

test('Gesperrtes Gerät meldet "blocked" und lädt nichts', { skip }, async () => {
  const dev = await studio.registerDevice('Gesperrt');
  await studio.call('PATCH', `/geraete/${dev.geraetId}`, { gesperrt: true });
  const e = new SyncEngine({ dataDir: tmp(), apiUrl: `${BASE}/api`, token: () => dev.token, log, pollSeconds: 3600 });
  const blocked = once(e, 'blocked');
  await e.checkNow();
  await blocked;
  assert.equal(e.status.blocked, true);
  await studio.call('DELETE', `/geraete/${dev.geraetId}`);
  const unregistered = once(e, 'unregistered');
  await e.checkNow();
  await unregistered;
});
