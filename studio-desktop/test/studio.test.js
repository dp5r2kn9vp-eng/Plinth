'use strict';
// Ende-zu-Ende ohne Electron: Studio-Server (lokale API) + echter Offline-Empfang des Players.
// Projekt anlegen → Video hochladen (Multipart) → Entwurf speichern → veröffentlichen → Player suchen,
// koppeln → verteilen → Player zeigt den Stand; zweite Revision überträgt nur Neues.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStudioServer } = require('../src/server');
const { Config } = require('../../player/src/config');
const { OfflineReceiver } = require('../../player/src/offline');

const ROOT = path.join(__dirname, '..', '..');
const log = { info() {}, warn() {}, error() {} };
const plain = { available: () => false, encrypt: (s) => Buffer.from(s), decrypt: (b) => b.toString() };

let studio;
let base;
let tmp;
let rx;
let rxConfig;
let projekt;
let video;
let poster;

async function api(method, p, body) {
  const res = await fetch(base + p, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) throw Object.assign(new Error(`${method} ${p}: ${res.status} ${JSON.stringify(data)}`), { status: res.status, data });
  return data;
}

async function upload(name, mime, buf) {
  const info = await api('POST', '/api/v1/uploads', { name, mime, groesse: buf.length });
  const { teilGroesse, teileAnzahl } = info.upload;
  const teile = [];
  for (let n = 1; n <= teileAnzahl; n++) {
    const { urls } = await api('POST', `/api/v1/uploads/${info.datei.id}/teile`, { teile: [n] });
    const res = await fetch(base + urls[n], { method: 'PUT', body: buf.subarray((n - 1) * teilGroesse, n * teilGroesse) });
    assert.equal(res.status, 200);
    teile.push({ nummer: n, etag: res.headers.get('etag') });
  }
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  return (await api('POST', `/api/v1/uploads/${info.datei.id}/abschliessen`, { teile, sha256 })).datei;
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plinth-studio-'));
  // Player (Offline-Empfang) auf freien Ports
  rxConfig = new Config(path.join(tmp, 'player'), plain);
  fs.mkdirSync(path.join(tmp, 'player'), { recursive: true });
  rx = new OfflineReceiver({ dataDir: path.join(tmp, 'player'), config: rxConfig, log, version: '1.2.3', port: 0, discoveryPort: 0 });
  await rx.start();
  rx.port = rx.server.address().port;

  studio = createStudioServer({
    dataDir: path.join(tmp, 'studio'),
    studioDir: path.join(ROOT, 'studio'),
    sharedDir: path.join(ROOT, 'shared'),
    playerOptions: { discoveryPort: rx.udp.address().port, discoveryTargets: ['127.0.0.1'], discoveryMs: 400 },
  });
  const port = await studio.listen(0);
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  rx.stop();
  await studio.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('Fremder Host-Header wird abgewiesen (DNS-Rebinding)', async () => {
  const http = require('node:http');
  const status = await new Promise((resolve) => {
    http.get(`${base}/api/v1/auth/me`, { headers: { Host: 'evil.example:80' } }, (res) => resolve(res.statusCode));
  });
  assert.equal(status, 403);
});

test('Studio-Oberfläche und Renderer werden ausgeliefert', async () => {
  const html = await (await fetch(`${base}/studio/`)).text();
  assert.match(html, /Plinth Studio/);
  const js = await fetch(`${base}/shared/renderer/renderer.js`);
  assert.match(js.headers.get('content-type'), /javascript/);
  assert.equal((await fetch(`${base}/studio/../server.js`)).status, 404);
  const me = await api('GET', '/api/v1/auth/me');
  assert.equal(me.modus, 'offline');
});

test('Projekt anlegen, Medien hochladen, Entwurf speichern', async () => {
  projekt = (await api('POST', '/api/v1/projekte', { name: 'Foyer', ausrichtung: 'landscape' })).projekt;
  video = await upload('film.mp4', 'video/mp4', crypto.randomBytes(17 * 1024 * 1024 + 123)); // 2 Teile
  poster = await upload('film-vorschau.jpg', 'image/jpeg', crypto.randomBytes(4000));
  await api('PATCH', `/api/v1/dateien/${video.id}`, { breite: 1920, hoehe: 1080, dauerSekunden: 12.5, vorschauDateiId: poster.id });
  const { dateien } = await api('GET', '/api/v1/dateien');
  assert.equal(dateien.length, 2);
  const v = dateien.find((d) => d.id === video.id);
  assert.equal(v.vorschauDateiId, poster.id);
  // Video mit Range abrufbar (Vorschau im Studio)
  const r = await fetch(base + v.url, { headers: { Range: 'bytes=0-9' } });
  assert.equal(r.status, 206);
  assert.equal((await r.arrayBuffer()).byteLength, 10);

  const draft = await api('GET', `/api/v1/projekte/${projekt.id}/entwurf`);
  draft.layout.pages[0].elements.push({ id: 'film', type: 'thumbnail', x: 100, y: 100, w: 800, h: 450, video: video.ref, title: 'Film' });
  const saved = await api('PUT', `/api/v1/projekte/${projekt.id}/entwurf`, { layout: draft.layout, version: draft.version });
  assert.equal(saved.version, draft.version + 1);
  await assert.rejects(api('PUT', `/api/v1/projekte/${projekt.id}/entwurf`, { layout: draft.layout, version: draft.version }), (e) => e.data.error.code === 'draft_conflict');
  const bad = structuredClone(draft.layout);
  bad.pages[0].elements[0].type = 'unbekannt';
  await assert.rejects(api('PUT', `/api/v1/projekte/${projekt.id}/entwurf`, { layout: bad, version: saved.version }), (e) => e.data.error.code === 'invalid_layout');
});

test('Falsche Prüfsumme beim Upload wird abgelehnt', async () => {
  const info = await api('POST', '/api/v1/uploads', { name: 'x.png', mime: 'image/png', groesse: 10 });
  const { urls } = await api('POST', `/api/v1/uploads/${info.datei.id}/teile`, { teile: [1] });
  await fetch(base + urls[1], { method: 'PUT', body: Buffer.alloc(10) });
  await assert.rejects(api('POST', `/api/v1/uploads/${info.datei.id}/abschliessen`, { teile: [], sha256: 'a'.repeat(64) }), (e) => e.data.error.code === 'checksum');
  await api('DELETE', `/api/v1/uploads/${info.datei.id}`);
});

test('Veröffentlichen erzeugt Revision mit Standbild', async () => {
  const { revision } = await api('POST', `/api/v1/projekte/${projekt.id}/veroeffentlichen`, {});
  assert.equal(revision.nummer, 1);
  assert.equal(revision.dateien, 2, 'Video + automatisches Standbild');
  const { projekte } = await api('GET', '/api/v1/projekte');
  assert.equal(projekte[0].revision, 1);
});

test('Player wird gefunden und mit Kopplungscode gekoppelt', async () => {
  let list = await api('GET', '/api/v1/offline/player');
  assert.equal(list.player.length, 0);
  assert.equal(list.gefunden.length, 1, 'per UDP-Suche gefunden');
  assert.equal(list.gefunden[0].host, '127.0.0.1');

  await api('PUT', '/api/v1/offline/einstellungen', { pin: '2468' });
  await assert.rejects(api('POST', '/api/v1/offline/player', { host: '127.0.0.1', port: rx.port, code: '12345' }), (e) => e.status === 422);
  const wrong = rxConfig.get('pairCode') === '000000' ? '111111' : '000000';
  await assert.rejects(api('POST', '/api/v1/offline/player', { host: '127.0.0.1', port: rx.port, code: wrong }), (e) => e.data.error.code === 'invalid_code');
  const { player } = await api('POST', '/api/v1/offline/player', { host: '127.0.0.1', port: rx.port, code: rxConfig.get('pairCode'), name: 'Foyer links' });
  assert.equal(player.name, 'Foyer links');
  assert.ok(rxConfig.checkPin('2468'), 'Wartungs-PIN vom Studio übernommen');

  list = await api('GET', '/api/v1/offline/player');
  assert.equal(list.player.length, 1);
  assert.equal(list.player[0].online, true);
  assert.equal(list.gefunden.length, 0);
  assert.equal(JSON.stringify(list).includes(studio.db.data.player[0].token), false, 'Token bleibt im Studio-Prozess');
});

async function distribute() {
  let { verteilung } = await api('POST', '/api/v1/offline/verteilen', { projektId: projekt.id });
  for (let i = 0; i < 200 && !verteilung.fertig; i++) {
    await new Promise((r) => setTimeout(r, 50));
    ({ verteilung } = await api('GET', `/api/v1/offline/verteilen/${verteilung.id}`));
  }
  return verteilung;
}

test('Verteilen überträgt alles, Player schaltet um', async () => {
  const shown = [];
  rx.on('content', (m) => shown.push(m));
  const v = await distribute();
  const st = Object.values(v.player)[0];
  assert.equal(st.phase, 'fertig', st.fehler ?? '');
  assert.equal(st.total, 17 * 1024 * 1024 + 123 + 4000);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].revision, 1);
  assert.equal(shown[0].projekt.name, 'Foyer');
  assert.equal(rx.store.playable().files.length, 2);
});

test('Zweite Revision überträgt nur neue Dateien', async () => {
  const bild = await upload('logo.png', 'image/png', crypto.randomBytes(3000));
  const draft = await api('GET', `/api/v1/projekte/${projekt.id}/entwurf`);
  draft.layout.pages[0].elements.push({ id: 'logo', type: 'image', x: 0, y: 0, w: 100, h: 100, image: bild.ref });
  await api('PUT', `/api/v1/projekte/${projekt.id}/entwurf`, { layout: draft.layout, version: draft.version });
  await api('POST', `/api/v1/projekte/${projekt.id}/veroeffentlichen`, {});
  const v = await distribute();
  const st = Object.values(v.player)[0];
  assert.equal(st.phase, 'fertig', st.fehler ?? '');
  assert.equal(st.total, 3000);
  assert.equal(rx.store.playable().revision, 2);
  const list = await api('GET', '/api/v1/offline/player');
  assert.equal(list.player[0].stand.revision, 2);
});

test('Abgebrochene Übertragung wird fortgesetzt', async () => {
  // Player-Daten löschen, Teil einer Datei vorab ablegen
  const big = rx.store.playable().files.find((f) => f.mime === 'video/mp4');
  fs.rmSync(path.join(tmp, 'player', 'media', path.basename(big.path)));
  fs.writeFileSync(path.join(tmp, 'player', 'state.json'), JSON.stringify({ current: null, previous: null }));
  const src = path.join(tmp, 'studio', 'medien', path.basename(big.path));
  fs.writeFileSync(path.join(tmp, 'player', 'tmp', `${path.basename(big.path)}.part`), fs.readFileSync(src).subarray(0, 10 * 1024 * 1024));
  const v = await distribute();
  const st = Object.values(v.player)[0];
  assert.equal(st.phase, 'fertig', st.fehler ?? '');
  assert.equal(st.total, big.size - 10 * 1024 * 1024, 'nur der Rest wurde übertragen');
  assert.equal(rx.store.playable().revision, 2);
});

test('Ungekoppelter Player meldet verständlichen Fehler', async () => {
  rxConfig.set({ studios: [] });
  const v = await distribute();
  assert.match(Object.values(v.player)[0].fehler, /neu koppeln/);
});
