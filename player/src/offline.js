'use strict';
// Offline-Betrieb: Der Player nimmt Projekte direkt von Plinth Studio im lokalen Netz an (kein Server nötig).
//
// Protokoll (HTTP, Standard-Port 47800, Beschreibung in docs/offline.md):
//   GET  /plinth/v1/info                       öffentlich: Name, Geräte-ID, Version, Stand
//   POST /plinth/v1/koppeln {code, studio, pin?} → {token}   Kopplungscode vom Bildschirm
//   POST /plinth/v1/pruefen {files[]}          → {missing:[{path, offset}]}
//   PUT  /plinth/v1/medien/<sha256>.<ext>?offset=N  Datei blockweise/fortsetzbar übertragen
//   POST /plinth/v1/aktivieren {manifest, projekt}   umschalten, sobald alles geprüft vorliegt
//   POST /plinth/v1/einstellungen {name?, pin?, hideCursor?}
// Suche: UDP-Broadcast "PLINTH-SUCHE" an Port 47801, Antwort ist JSON wie /info.
//
// Speicherablage wie beim Cloud-Sync (media/, manifests/, state.json), damit Rückfall und Aufräumen gleich funktionieren.

const crypto = require('node:crypto');
const dgram = require('node:dgram');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const { SyncEngine } = require('./sync');
const { writeJson } = require('./fsutil');

const HTTP_PORT = 47800;
const DISCOVERY_PORT = 47801;
const DISCOVERY_MAGIC = 'PLINTH-SUCHE';
const MAX_JSON = 8 * 1024 * 1024;
const NAME_RE = /^[a-f0-9]{64}\.[a-z0-9]{1,8}$/;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

class OfflineReceiver extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.dataDir
   * @param {import('./config').Config} o.config
   * @param {{info:Function,warn:Function,error:Function}} o.log
   * @param {string} o.version
   * @param {number} [o.port]
   * @param {number} [o.discoveryPort]
   */
  constructor(o) {
    super();
    this.o = o;
    this.config = o.config;
    this.log = o.log;
    this.port = o.port ?? (Number(this.config.get('offlinePort')) || HTTP_PORT);
    this.discoveryPort = o.discoveryPort ?? DISCOVERY_PORT;
    // Speicherfunktionen des Cloud-Syncs wiederverwenden (ohne Abfragen)
    this.store = new SyncEngine({ dataDir: o.dataDir, apiUrl: '', token: () => null, log: o.log });
    this.locks = new Set();
    this.pairFails = { count: 0, until: 0 };
    this.status = { online: true, lastCheck: null, lastError: null, revision: null, download: null, blocked: false, offline: true };
    this.ensureIdentity();
  }

  ensureIdentity() {
    const patch = {};
    if (!this.config.get('deviceId')) patch.deviceId = crypto.randomUUID();
    if (!this.config.get('pairCode')) patch.pairCode = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    if (!Array.isArray(this.config.get('studios'))) patch.studios = [];
    if (Object.keys(patch).length) this.config.set(patch);
  }

  get pairCode() {
    return this.config.get('pairCode');
  }

  get paired() {
    return this.config.get('studios').length > 0;
  }

  /** Adressen, unter denen der Player im Netz erreichbar ist (für die Anzeige). */
  addresses() {
    const out = [];
    for (const list of Object.values(os.networkInterfaces())) {
      for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
    return out;
  }

  info() {
    const s = this.store.state();
    const m = this.store.manifest(s.current);
    return {
      app: 'plinth-player',
      protocol: 1,
      version: this.o.version,
      deviceId: this.config.get('deviceId'),
      name: this.config.get('deviceName') || os.hostname(),
      platform: process.platform === 'win32' ? 'windows' : process.platform,
      port: this.port,
      paired: this.paired,
      projekt: m ? { id: m.projekt?.id ?? null, name: m.projekt?.name ?? null, revision: m.revision } : null,
    };
  }

  // ---------- Ablauf ----------

  async start() {
    const m = this.store.playable();
    if (m) {
      this.setStatus({ revision: m.revision });
      this.emit('content', m);
    }
    this.server = http.createServer((req, res) => this.handle(req, res).catch((e) => {
      this.log.error('Offline-Empfang: Fehler', { error: e.message });
      if (!res.headersSent) send(res, 500, { error: { code: 'internal', message: e.message } });
      else res.destroy();
    }));
    this.server.requestTimeout = 0; // große Dateien
    this.server.headersTimeout = 30000;
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, '0.0.0.0', resolve);
    }).catch((e) => {
      this.setStatus({ lastError: `Port ${this.port} belegt` });
      this.log.error('Offline-Empfang konnte nicht starten', { port: this.port, error: e.message });
      throw e;
    });
    await this.startDiscovery();
    this.log.info('Offline-Empfang bereit', { port: this.port, adressen: this.addresses() });
  }

  stop() {
    this.server?.close();
    this.server?.closeAllConnections?.();
    this.udp?.close();
    this.server = null;
    this.udp = null;
  }

  /** Antwortet auf Suchanfragen des Studios. Fehler hier sind nicht kritisch (Koppeln per IP geht immer). */
  startDiscovery() {
    const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const ready = new Promise((resolve) => {
      udp.once('listening', resolve);
      udp.once('error', resolve);
    });
    udp.on('error', (e) => this.log.warn('Suche im Netz nicht verfügbar', { error: e.message }));
    udp.on('message', (msg, rinfo) => {
      if (msg.toString('utf8').trim() !== DISCOVERY_MAGIC) return;
      const reply = Buffer.from(JSON.stringify(this.info()));
      udp.send(reply, rinfo.port, rinfo.address);
    });
    udp.bind(this.discoveryPort);
    this.udp = udp;
    return ready;
  }

  setStatus(patch) {
    Object.assign(this.status, patch);
    this.emit('status', { ...this.status });
  }

  // ---------- HTTP ----------

  async handle(req, res) {
    const url = new URL(req.url, 'http://player');
    const p = url.pathname;
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'GET' && p === '/plinth/v1/info') return send(res, 200, this.info());
    if (req.method === 'POST' && p === '/plinth/v1/koppeln') return this.pair(req, res);

    const studio = this.auth(req);
    if (!studio) return send(res, 401, { error: { code: 'not_paired', message: 'Nicht gekoppelt. Bitte im Studio mit dem Kopplungscode verbinden.' } });

    if (req.method === 'POST' && p === '/plinth/v1/pruefen') return this.check(req, res);
    if (req.method === 'PUT' && p.startsWith('/plinth/v1/medien/')) return this.receive(req, res, decodeURIComponent(p.slice('/plinth/v1/medien/'.length)), url);
    if (req.method === 'POST' && p === '/plinth/v1/aktivieren') return this.activate(req, res, studio);
    if (req.method === 'POST' && p === '/plinth/v1/einstellungen') return this.settings(req, res);
    return send(res, 404, { error: { code: 'not_found', message: 'Unbekannter Pfad' } });
  }

  auth(req) {
    const m = /^Bearer\s+(\S+)$/.exec(req.headers.authorization ?? '');
    if (!m) return null;
    const hash = sha256(m[1]);
    return this.config.get('studios').find((s) => crypto.timingSafeEqual(Buffer.from(s.tokenHash, 'hex'), Buffer.from(hash, 'hex'))) ?? null;
  }

  async pair(req, res) {
    if (Date.now() < this.pairFails.until) return send(res, 429, { error: { code: 'locked', message: 'Zu viele Fehlversuche. Bitte einige Minuten warten.' } });
    const body = await readJson(req);
    if (String(body.code ?? '').replace(/\D/g, '') !== this.pairCode) {
      this.pairFails.count++;
      if (this.pairFails.count >= 5) {
        this.pairFails = { count: 0, until: Date.now() + 5 * 60 * 1000 };
        this.log.warn('Kopplung: 5 Fehlversuche, 5 Minuten gesperrt');
      }
      return send(res, 403, { error: { code: 'invalid_code', message: 'Kopplungscode ist falsch.' } });
    }
    this.pairFails.count = 0;
    const token = crypto.randomBytes(32).toString('base64url');
    const studioName = String(body.studio ?? 'Plinth Studio').slice(0, 100);
    const studioId = String(body.studioId ?? '').slice(0, 64) || crypto.randomUUID();
    // Dasselbe Studio erneut gekoppelt: alten Schlüssel ersetzen
    const studios = this.config.get('studios').filter((s) => s.id !== studioId);
    studios.push({ id: studioId, name: studioName, tokenHash: sha256(token), pairedAt: new Date().toISOString() });
    this.config.set({ studios });
    this.applySettings(body);
    this.log.info('Mit Studio gekoppelt', { studio: studioName });
    this.emit('paired');
    return send(res, 200, { token, ...this.info() });
  }

  applySettings(body) {
    const patch = {};
    if (typeof body.name === 'string' && body.name.trim()) patch.deviceName = body.name.trim().slice(0, 100);
    if (typeof body.hideCursor === 'boolean') patch.hideCursor = body.hideCursor;
    if (Object.keys(patch).length) this.config.set(patch);
    if (typeof body.pin === 'string' && /^\d{4,8}$/.test(body.pin)) this.config.setPin(body.pin);
    if (Object.keys(patch).length || body.pin) this.emit('settings');
  }

  async settings(req, res) {
    this.applySettings(await readJson(req));
    return send(res, 200, this.info());
  }

  validFile(f) {
    return f && typeof f.path === 'string' && NAME_RE.test(path.basename(f.path)) && f.path === `media/${path.basename(f.path)}`
      && Number.isSafeInteger(f.size) && f.size >= 0 && /^[a-f0-9]{64}$/.test(f.sha256) && path.basename(f.path).startsWith(f.sha256);
  }

  partFile(name) {
    return path.join(this.store.tmpDir, `${name}.part`);
  }

  partSize(name) {
    try {
      return fs.statSync(this.partFile(name)).size;
    } catch {
      return 0;
    }
  }

  async check(req, res) {
    const { files } = await readJson(req);
    if (!Array.isArray(files) || !files.every((f) => this.validFile(f))) return send(res, 422, { error: { code: 'invalid', message: 'Ungültige Dateiliste' } });
    const missing = files.filter((f) => !this.store.has(f)).map((f) => ({ path: f.path, offset: Math.min(this.partSize(path.basename(f.path)), f.size) }));
    return send(res, 200, { missing });
  }

  /** Nimmt eine Datei ab offset entgegen. Header: X-Plinth-Size (Gesamtgröße). Prüft SHA-256 am Ende. */
  async receive(req, res, name, url) {
    if (!NAME_RE.test(name)) return send(res, 422, { error: { code: 'invalid', message: 'Ungültiger Dateiname' } });
    const total = Number(req.headers['x-plinth-size']);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    if (!Number.isSafeInteger(total) || total < 0) return send(res, 422, { error: { code: 'invalid', message: 'X-Plinth-Size fehlt' } });
    const final = path.join(this.store.mediaDir, name);
    if (fs.existsSync(final) && fs.statSync(final).size === total) {
      req.resume();
      return send(res, 200, { offset: total, complete: true });
    }
    if (this.locks.has(name)) {
      req.resume();
      return send(res, 409, { error: { code: 'busy', message: 'Datei wird gerade übertragen' } });
    }
    this.locks.add(name);
    try {
      const part = this.partFile(name);
      let have = this.partSize(name);
      if (have > total) {
        fs.rmSync(part, { force: true });
        have = 0;
      }
      if (offset !== have) {
        req.resume();
        return send(res, 409, { error: { code: 'offset', message: 'Falscher Startpunkt' }, offset: have });
      }
      const s = this.status.download;
      this.setStatus({ download: { done: offset, total, files: 1, ...(s ?? {}) } });
      let n = offset;
      let lastEmit = 0;
      const tap = new Transform({
        transform: (chunk, _enc, cb) => {
          n += chunk.length;
          if (n > total) return cb(new Error('Mehr Daten als angekündigt'));
          if (Date.now() - lastEmit > 500) {
            lastEmit = Date.now();
            this.setStatus({ download: { done: n, total, files: 1 } });
          }
          cb(null, chunk);
        },
      });
      try {
        await pipeline(req, tap, fs.createWriteStream(part, { flags: offset ? 'a' : 'w' }));
      } catch (e) {
        // Verbindung abgerissen: angefangene Datei bleibt für die Fortsetzung liegen
        this.log.warn('Übertragung unterbrochen', { file: name, bytes: this.partSize(name), error: e.message });
        if (!res.headersSent && !res.destroyed) send(res, 400, { error: { code: 'aborted', message: e.message }, offset: this.partSize(name) });
        return undefined;
      }
      have = this.partSize(name);
      if (have < total) return send(res, 200, { offset: have, complete: false });
      const sha = await this.store.hashFile(part);
      if (sha !== name.split('.')[0]) {
        fs.rmSync(part, { force: true });
        this.log.warn('Prüfsumme falsch – Datei verworfen', { file: name });
        return send(res, 422, { error: { code: 'checksum', message: 'Prüfsumme falsch, Datei wird neu übertragen' }, offset: 0 });
      }
      fs.renameSync(part, final);
      return send(res, 200, { offset: total, complete: true });
    } finally {
      this.locks.delete(name);
    }
  }

  async activate(req, res, studio) {
    const { manifest, projekt } = await readJson(req);
    try {
      this.store.validate(manifest);
    } catch (e) {
      return send(res, 422, { error: { code: 'invalid_manifest', message: e.message } });
    }
    if (!manifest.files.every((f) => this.validFile(f))) return send(res, 422, { error: { code: 'invalid_manifest', message: 'Ungültige Dateiliste' } });
    const missing = manifest.files.filter((f) => !this.store.has(f)).map((f) => f.path);
    if (missing.length) return send(res, 409, { error: { code: 'files_missing', message: `${missing.length} Datei(en) fehlen noch` }, missing });

    const proj = { id: String(projekt?.id ?? ''), name: String(projekt?.name ?? '').slice(0, 190), studio: studio.name };
    const stored = { ...manifest, projekt: proj };
    const key = `offline-${sha256(`${studio.id}:${proj.id}`).slice(0, 12)}-${manifest.revision}`;
    writeJson(path.join(this.store.manifestDir, `${key}.json`), stored);
    const s = this.store.state();
    writeJson(this.store.stateFile, { current: key, previous: s.current !== key ? s.current : s.previous });
    this.store.cleanup();
    for (const name of fs.readdirSync(this.store.tmpDir)) fs.rmSync(path.join(this.store.tmpDir, name), { force: true });
    this.setStatus({ download: null, revision: manifest.revision, lastCheck: Date.now(), lastError: null });
    this.log.info('Neuer Stand aus dem Studio aktiv', { projekt: proj.name, revision: manifest.revision, studio: studio.name });
    this.emit('content', stored);
    return send(res, 200, this.info());
  }
}

function send(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length });
  res.end(data);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_JSON) throw new Error('Anfrage zu groß');
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}

module.exports = { OfflineReceiver, HTTP_PORT, DISCOVERY_PORT, DISCOVERY_MAGIC };
