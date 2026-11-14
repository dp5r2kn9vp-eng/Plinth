'use strict';
// Interop: Plinth Studio (Node, studio-desktop) gegen den Kern des Android-Players (Kotlin, auf der JVM).
// Voraussetzung: ./gradlew :core:installDist  und  (cd ../studio-desktop && npm ci)
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const dgram = require('node:dgram');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStudioServer } = require('../../studio-desktop/src/server');

const ROOT = path.join(__dirname, '..', '..');
const BIN = path.join(__dirname, '..', 'core', 'build', 'install', 'plinth-core', 'bin', process.platform === 'win32' ? 'plinth-core.bat' : 'plinth-core');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

let tmp;
let proc;
let port;
let udpPort;
let pairCode;
let studio;
let base;
let token;

async function startCore() {
  proc = spawn(BIN, [path.join(tmp, 'player'), '0', '0', path.join(ROOT, 'player', 'src', 'renderer')], { stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stderr.on('data', (d) => process.env.DEBUG && process.stderr.write(d));
  const line = await new Promise((resolve, reject) => {
    let buf = '';
    proc.stdout.on('data', (d) => {
      buf += d;
      const m = /BEREIT (\d+) (\d+) (\d{6})/.exec(buf);
      if (m) resolve(m);
    });
    proc.on('exit', (c) => reject(new Error(`Kern beendet (${c})`)));
    setTimeout(() => reject(new Error('Kern startet nicht')), 30000);
  });
  [, port, udpPort, pairCode] = line;
  port = Number(port);
  udpPort = Number(udpPort);
}

const call = (method, p, body, headers = {}) => fetch(`http://127.0.0.1:${port}${p}`, {
  method,
  headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}), ...headers },
  body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined,
});

async function api(method, p, body) {
  const res = await fetch(base + p, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) throw Object.assign(new Error(`${method} ${p}: ${res.status} ${JSON.stringify(data)}`), { status: res.status, data });
  return data;
}

async function upload(name, mime, buf) {
  const info = await api('POST', '/api/v1/uploads', { name, mime, groesse: buf.length });
  const { teilGroesse, teileAnzahl } = info.upload;
  for (let n = 1; n <= teileAnzahl; n++) {
    const { urls } = await api('POST', `/api/v1/uploads/${info.datei.id}/teile`, { teile: [n] });
    await fetch(base + urls[n], { method: 'PUT', body: buf.subarray((n - 1) * teilGroesse, n * teilGroesse) });
  }
  return (await api('POST', `/api/v1/uploads/${info.datei.id}/abschliessen`, { teile: [], sha256: sha(buf) })).datei;
}

async function distribute(projektId) {
  let { verteilung } = await api('POST', '/api/v1/offline/verteilen', { projektId });
  for (let i = 0; i < 400 && !verteilung.fertig; i++) {
    await new Promise((r) => setTimeout(r, 50));
    ({ verteilung } = await api('GET', `/api/v1/offline/verteilen/${verteilung.id}`));
  }
  return Object.values(verteilung.player)[0];
}

before(async () => {
  assert.ok(fs.existsSync(BIN), `${BIN} fehlt – zuerst ./gradlew :core:installDist`);
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plinth-android-'));
  await startCore();
  studio = createStudioServer({
    dataDir: path.join(tmp, 'studio'), studioDir: path.join(ROOT, 'studio'), sharedDir: path.join(ROOT, 'shared'),
    playerOptions: { discoveryPort: udpPort, discoveryTargets: ['127.0.0.1'], discoveryMs: 500 },
  });
  base = `http://127.0.0.1:${await studio.listen(0)}`;
});

after(async () => {
  proc?.kill();
  await studio?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('Info und UDP-Suche wie beim Windows-Player', async () => {
  const info = await (await call('GET', '/plinth/v1/info')).json();
  assert.equal(info.app, 'plinth-player');
  assert.equal(info.platform, 'android');
  assert.equal(info.paired, false);
  const sock = dgram.createSocket('udp4');
  const reply = new Promise((resolve) => sock.on('message', (m) => resolve(JSON.parse(m.toString()))));
  sock.send('PLINTH-SUCHE', udpPort, '127.0.0.1');
  assert.equal((await reply).deviceId, info.deviceId);
  sock.close();
});

test('Ohne Kopplung kein Zugriff; falscher Code abgelehnt', async () => {
  assert.equal((await call('POST', '/plinth/v1/pruefen', { files: [] })).status, 401);
  assert.equal((await call('POST', '/plinth/v1/koppeln', { code: pairCode === '000000' ? '111111' : '000000' })).status, 403);
});

test('Protokoll: fortsetzbare Übertragung, Prüfsumme, Pfadschutz', async () => {
  const res = await call('POST', '/plinth/v1/koppeln', { code: pairCode, studio: 'Protokolltest', studioId: 'p1' });
  token = (await res.json()).token;
  const data = crypto.randomBytes(200000);
  const name = `${sha(data)}.mp4`;
  let r = await call('PUT', `/plinth/v1/medien/${name}?offset=0`, new Uint8Array(data.subarray(0, 50000)), { 'X-Plinth-Size': String(data.length) });
  assert.deepEqual(await r.json(), { offset: 50000, complete: false });
  r = await call('PUT', `/plinth/v1/medien/${name}?offset=7`, new Uint8Array(data.subarray(7)), { 'X-Plinth-Size': String(data.length) });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).offset, 50000);
  r = await call('POST', '/plinth/v1/pruefen', { files: [{ path: `media/${name}`, size: data.length, sha256: sha(data) }] });
  assert.equal((await r.json()).missing[0].offset, 50000);
  r = await call('PUT', `/plinth/v1/medien/${name}?offset=50000`, new Uint8Array(data.subarray(50000)), { 'X-Plinth-Size': String(data.length) });
  assert.deepEqual(await r.json(), { offset: data.length, complete: true });

  const bad = crypto.randomBytes(100);
  r = await call('PUT', `/plinth/v1/medien/${'a'.repeat(64)}.png?offset=0`, new Uint8Array(bad), { 'X-Plinth-Size': '100' });
  assert.equal(r.status, 422);
  r = await call('PUT', '/plinth/v1/medien/..%2F..%2Fx.exe?offset=0', new Uint8Array([1]), { 'X-Plinth-Size': '1' });
  assert.equal(r.status, 422);
  r = await call('POST', '/plinth/v1/aktivieren', { manifest: { schemaVersion: 1, revision: 1, layout: {}, files: [{ id: 'f', path: '../x', size: 1, sha256: 'a'.repeat(64) }] } });
  assert.equal(r.status, 422);
  token = null;
});

test('Oberfläche und Medien nur für das eigene Gerät', async () => {
  const html = await (await call('GET', '/app/index.html')).text();
  assert.match(html, /Plinth Player/);
  assert.equal((await call('GET', '/app/..%2F..%2Fetc%2Fpasswd')).status, 403);
  const addr = Object.values(os.networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal)?.address;
  if (addr) {
    const r = await fetch(`http://${addr}:${port}/app/index.html`);
    assert.equal(r.status, 403, 'von außen gesperrt');
  }
});

test('Studio findet, koppelt und beliefert den Android-Player', async () => {
  const projekt = (await api('POST', '/api/v1/projekte', { name: 'Foyer', ausrichtung: 'portrait' })).projekt;
  const video = await upload('film.mp4', 'video/mp4', crypto.randomBytes(17 * 1024 * 1024 + 5));
  const draft = await api('GET', `/api/v1/projekte/${projekt.id}/entwurf`);
  draft.layout.pages[0].elements.push({ id: 'v', type: 'thumbnail', x: 0, y: 0, w: 500, h: 300, video: video.ref, title: 'Film' });
  await api('PUT', `/api/v1/projekte/${projekt.id}/entwurf`, { layout: draft.layout, version: draft.version });
  await api('POST', `/api/v1/projekte/${projekt.id}/veroeffentlichen`, {});

  const list = await api('GET', '/api/v1/offline/player');
  assert.equal(list.gefunden.length, 1);
  assert.equal(list.gefunden[0].plattform, 'android');
  await api('PUT', '/api/v1/offline/einstellungen', { pin: '1357' });
  await api('POST', '/api/v1/offline/player', { host: '127.0.0.1', port, code: pairCode, name: 'Tablet Eingang' });

  const st = await distribute(projekt.id);
  assert.equal(st.phase, 'fertig', st.fehler ?? '');
  const info = await (await call('GET', '/plinth/v1/info')).json();
  assert.equal(info.name, 'Tablet Eingang');
  assert.equal(info.projekt.revision, 1);
  assert.equal(info.projekt.name, 'Foyer');

  // Oberfläche bekommt den Inhalt über das Long-Polling, Video mit Range abrufbar
  const poll = await (await call('GET', '/app-api/poll?v=-1')).json();
  assert.equal(poll.state.screen, 'player');
  assert.equal(poll.content.revision, 1);
  const url = Object.values(poll.content.files)[0];
  const r = await call('GET', url, undefined, { Range: 'bytes=0-99' });
  assert.equal(r.status, 206);
  assert.equal((await r.arrayBuffer()).byteLength, 100);

  // Wartungs-PIN vom Studio gilt
  assert.equal((await (await call('POST', '/app-api/pin', { pin: pairCode })).json()).result, 'wrong');
  assert.equal((await (await call('POST', '/app-api/pin', { pin: '1357' })).json()).result, 'ok');
  const inf = await (await call('POST', '/app-api/action', { action: 'info' })).json();
  assert.equal(inf.ok, true);
  assert.deepEqual(inf.info.offline.studios.includes(os.hostname()), true);

  // Zweite Revision: nur Neues wird übertragen; Rückfall bleibt erhalten
  const bild = await upload('logo.png', 'image/png', crypto.randomBytes(2000));
  const d2 = await api('GET', `/api/v1/projekte/${projekt.id}/entwurf`);
  d2.layout.pages[0].elements.push({ id: 'b', type: 'image', x: 0, y: 0, w: 10, h: 10, image: bild.ref });
  await api('PUT', `/api/v1/projekte/${projekt.id}/entwurf`, { layout: d2.layout, version: d2.version });
  await api('POST', `/api/v1/projekte/${projekt.id}/veroeffentlichen`, {});
  const st2 = await distribute(projekt.id);
  assert.equal(st2.phase, 'fertig', st2.fehler ?? '');
  assert.equal(st2.total, 2000);
  const state = JSON.parse(fs.readFileSync(path.join(tmp, 'player', 'state.json'), 'utf8'));
  assert.match(state.current, /-2$/);
  assert.match(state.previous, /-1$/);
});

test('Neustart: Player zeigt den letzten Stand sofort wieder', async () => {
  proc.kill();
  await new Promise((r) => proc.once('exit', r));
  await startCore();
  const poll = await (await call('GET', '/app-api/poll?v=-1')).json();
  assert.equal(poll.content.revision, 2);
  const cfg = JSON.parse(fs.readFileSync(path.join(tmp, 'player', 'config.json'), 'utf8'));
  assert.equal(JSON.stringify(cfg).includes('"token"'), false, 'kein Klartext-Token gespeichert');
});
