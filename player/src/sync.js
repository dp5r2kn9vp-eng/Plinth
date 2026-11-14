'use strict';
// Synchronisation mit der Plinth-API:
// - fragt alle 30–60 s die Revisionsnummer ab (ETag, 304 = nichts zu tun)
// - lädt bei Änderung das Manifest und nur fehlende Dateien (SHA-256-adressiert, fortsetzbar per Range)
// - prüft jede Datei per SHA-256, lädt in tmp/ und verschiebt erst danach nach media/
// - schaltet erst um, wenn alles vollständig ist; die vorige Revision bleibt als Rückfall erhalten
// - funktioniert offline mit dem zuletzt geladenen Stand weiter
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Transform } = require('node:stream');
const http = require('node:http');
const https = require('node:https');
const { pipeline } = require('node:stream/promises');
const { readJson, writeJson } = require('./fsutil');

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

class SyncEngine extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.dataDir
   * @param {string} o.apiUrl   z. B. https://host/api
   * @param {() => string|null} o.token
   * @param {{info:Function,warn:Function,error:Function}} o.log
   * @param {number} [o.pollSeconds]
   * @param {string} [o.appVersion]
   * @param {typeof fetch} [o.fetch]   für API-Aufrufe
   * @param {(url:string, headers:object) => Promise<import('node:http').IncomingMessage>} [o.get]  für Downloads
   */
  constructor(o) {
    super();
    this.o = { pollSeconds: 45, appVersion: '0.0.0', fetch: globalThis.fetch, get: httpGet, ...o };
    this.dir = o.dataDir;
    this.mediaDir = path.join(this.dir, 'media');
    this.tmpDir = path.join(this.dir, 'tmp');
    this.manifestDir = path.join(this.dir, 'manifests');
    this.stateFile = path.join(this.dir, 'state.json');
    for (const d of [this.mediaDir, this.tmpDir, this.manifestDir]) fs.mkdirSync(d, { recursive: true });
    this.etag = null;
    this.timer = null;
    this.running = false;
    this.checking = null;
    this.status = { online: null, lastCheck: null, lastError: null, revision: null, download: null, blocked: false };
  }

  // ---------- Lokaler Stand ----------

  /** Lokaler Stand. Schlüssel "<projektId>-<revision>", da Revisionsnummern pro Projekt zählen. */
  state() {
    return readJson(this.stateFile, { current: null, previous: null });
  }

  manifest(key) {
    return key ? readJson(path.join(this.manifestDir, `${key}.json`)) : null;
  }

  /** Lokaler Pfad einer Manifest-Datei (nur innerhalb von media/) */
  localPath(file) {
    return path.join(this.mediaDir, path.basename(file.path));
  }

  complete(manifest) {
    return !!manifest && manifest.files.every((f) => {
      try {
        return fs.statSync(this.localPath(f)).size === f.size;
      } catch {
        return false;
      }
    });
  }

  /** Aktuell anzeigbares Manifest: aktuelles, sonst Rückfall auf das vorige. */
  playable() {
    const s = this.state();
    for (const key of [s.current, s.previous]) {
      const m = this.manifest(key);
      if (this.complete(m)) return m;
      if (m) this.o.log.warn('Lokaler Stand unvollständig, versuche Rückfall', { stand: key });
    }
    return null;
  }

  // ---------- Ablauf ----------

  start() {
    this.running = true;
    const m = this.playable();
    if (m) {
      this.setStatus({ revision: m.revision });
      this.emit('content', m);
    }
    this.loop();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
  }

  loop() {
    if (!this.running) return;
    this.checkNow().finally(() => {
      if (!this.running) return;
      // ±20 % Streuung, damit nicht alle Geräte gleichzeitig fragen
      const ms = this.o.pollSeconds * 1000 * (0.8 + Math.random() * 0.4);
      this.timer = setTimeout(() => this.loop(), ms);
    });
  }

  setStatus(patch) {
    Object.assign(this.status, patch);
    this.emit('status', { ...this.status });
  }

  async checkNow() {
    if (this.checking) return this.checking;
    this.checking = this.check().finally(() => {
      this.checking = null;
    });
    return this.checking;
  }

  async check() {
    try {
      const res = await this.request('/v1/player/revision', { headers: this.etag ? { 'If-None-Match': this.etag } : {} });
      this.setStatus({ online: true, lastCheck: Date.now(), blocked: false });
      if (res.status === 304) return;
      const { revision, projektId } = await res.json();
      const s = this.state();
      if (revision === null) {
        this.etag = res.headers.get('etag');
        return;
      }
      const key = `${projektId}-${revision}`;
      if (key !== s.current || !this.complete(this.manifest(s.current))) {
        await this.update(revision, projektId);
      }
      this.etag = res.headers.get('etag');
      this.setStatus({ lastError: null });
    } catch (e) {
      if (e.code === 'device_blocked') {
        this.setStatus({ online: true, blocked: true, lastError: 'Gerät ist gesperrt' });
        this.emit('blocked');
      } else if (e.code === 'device_unknown') {
        this.setStatus({ online: true, lastError: 'Gerät ist nicht (mehr) registriert' });
        this.emit('unregistered');
      } else {
        const offline = !(e instanceof HttpError);
        this.setStatus({ online: offline ? false : true, lastError: e.message });
      }
      this.o.log.warn('Synchronisation fehlgeschlagen', { error: e.message, code: e.code });
    }
  }

  async request(p, init = {}) {
    const token = this.o.token();
    if (!token) throw new HttpError(401, 'device_unknown', 'Kein Gerätetoken');
    const res = await this.o.fetch(this.o.apiUrl.replace(/\/$/, '') + p, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'X-Plinth-Version': this.o.appVersion, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(init.timeout ?? 30000),
    });
    if (res.status >= 400) {
      let err = {};
      try {
        err = (await res.json()).error ?? {};
      } catch {
        // kein JSON
      }
      throw new HttpError(res.status, err.code ?? `http_${res.status}`, err.message ?? `HTTP ${res.status}`);
    }
    return res;
  }

  async update(revision, projektId) {
    this.o.log.info('Neue Revision', { revision, projektId });
    let data = await (await this.request(`/v1/player/manifest?revision=${revision}`)).json();
    const manifest = data.manifest;
    this.validate(manifest);
    if (data.projektId !== projektId) throw new Error('Projekt wurde während des Abrufs gewechselt – neuer Versuch');
    const key = `${projektId}-${revision}`;

    const missing = manifest.files.filter((f) => !this.has(f));
    const unique = [...new Map(missing.map((f) => [f.path, f])).values()];
    const total = unique.reduce((s, f) => s + f.size, 0);
    let done = 0;
    this.setStatus({ download: { revision, done, total, files: unique.length } });

    for (const file of unique) {
      for (let attempt = 1; ; attempt++) {
        try {
          await this.download(file, data.downloads[file.id], (n) => {
            this.setStatus({ download: { revision, done: done + n, total, files: unique.length } });
          });
          break;
        } catch (e) {
          // Abgelaufene Links: Manifest mit frischen Links holen
          if (attempt < 3 && (e.status === 403 || e.status === 400)) {
            data = await (await this.request(`/v1/player/manifest?revision=${revision}`)).json();
            continue;
          }
          this.setStatus({ download: null });
          throw e;
        }
      }
      done += file.size;
    }

    // Alles da → atomar umschalten
    writeJson(path.join(this.manifestDir, `${key}.json`), manifest);
    const s = this.state();
    writeJson(this.stateFile, { current: key, previous: s.current !== key ? s.current : s.previous });
    this.cleanup();
    this.setStatus({ download: null, revision });
    this.o.log.info('Revision aktiv', { revision, projektId, files: manifest.files.length });
    this.emit('content', manifest);
    await this.request('/v1/player/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ geladeneRevision: revision }),
    }).catch((e) => this.o.log.warn('Statusmeldung fehlgeschlagen', { error: e.message }));
  }

  validate(m) {
    if (!m || m.schemaVersion !== 1 || !Array.isArray(m.files) || !m.layout) throw new Error('Manifest hat ein unbekanntes Format');
    for (const f of m.files) {
      if (!/^media\/[a-f0-9]{64}\.[a-z0-9]{1,8}$/.test(f.path) || !/^[a-f0-9]{64}$/.test(f.sha256)) throw new Error(`Ungültiger Dateieintrag ${f.id}`);
    }
  }

  has(file) {
    try {
      return fs.statSync(this.localPath(file)).size === file.size;
    } catch {
      return false;
    }
  }

  /** Lädt eine Datei (fortsetzbar) und prüft SHA-256. */
  async download(file, url, onProgress) {
    if (!url) throw new Error(`Kein Download-Link für ${file.id}`);
    const part = path.join(this.tmpDir, `${path.basename(file.path)}.part`);
    let offset = 0;
    try {
      offset = fs.statSync(part).size;
    } catch {
      offset = 0;
    }
    if (offset > file.size) {
      fs.rmSync(part);
      offset = 0;
    }

    const hash = crypto.createHash('sha256');
    if (offset > 0 && offset < file.size) {
      for await (const chunk of fs.createReadStream(part)) hash.update(chunk);
    }

    if (offset < file.size) {
      const res = await this.o.get(url, offset ? { Range: `bytes=${offset}-` } : {});
      const status = res.statusCode;
      if (status === 403 || status === 400) {
        res.resume();
        throw Object.assign(new Error(`Download abgelehnt (${status})`), { status });
      }
      if (status < 200 || status >= 300) {
        res.resume();
        throw new Error(`Download fehlgeschlagen (HTTP ${status})`);
      }
      if (offset && status !== 206) {
        res.destroy();
        // Server ignoriert Range: neu beginnen
        offset = 0;
        hash.destroy();
        return this.restart(part, file, url, onProgress);
      }
      if (offset) this.o.log.info('Download wird fortgesetzt', { file: file.path, offset });
      let n = offset;
      const out = fs.createWriteStream(part, { flags: offset ? 'a' : 'w' });
      const tap = new Transform({
        transform(chunk, _enc, cb) {
          hash.update(chunk);
          n += chunk.length;
          onProgress(n);
          cb(null, chunk);
        },
      });
      await pipeline(res, tap, out);
    } else {
      onProgress(file.size);
    }

    const size = fs.statSync(part).size;
    const sha = offset >= file.size ? await this.hashFile(part) : hash.digest('hex');
    if (size !== file.size || sha !== file.sha256) {
      fs.rmSync(part, { force: true });
      throw new Error(`Prüfsumme falsch für ${file.path}`);
    }
    fs.renameSync(part, this.localPath(file));
  }

  async restart(part, file, url, onProgress) {
    fs.rmSync(part, { force: true });
    return this.download(file, url, onProgress);
  }

  async hashFile(p) {
    const h = crypto.createHash('sha256');
    await pipeline(fs.createReadStream(p), h);
    return h.digest('hex');
  }

  /** Entfernt Dateien, die weder die aktuelle noch die vorige Revision braucht. */
  cleanup() {
    const s = this.state();
    const keepKeys = new Set([s.current, s.previous].filter(Boolean).map(String));
    const keep = new Set();
    for (const key of keepKeys) for (const f of this.manifest(key)?.files ?? []) keep.add(path.basename(f.path));
    for (const name of fs.readdirSync(this.mediaDir)) if (!keep.has(name)) fs.rmSync(path.join(this.mediaDir, name), { force: true });
    for (const name of fs.readdirSync(this.manifestDir)) if (!keepKeys.has(name.replace(/\.json$/, ''))) fs.rmSync(path.join(this.manifestDir, name), { force: true });
  }
}

/** GET mit Weiterleitungen und Leerlauf-Timeout (node:http statt fetch: stabil bei großen Streams). */
function httpGet(url, headers = {}, redirects = 3) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    const req = mod.get(url, { headers }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        resolve(httpGet(new URL(res.headers.location, url).toString(), headers, redirects - 1));
        return;
      }
      resolve(res);
    });
    req.setTimeout(60000, () => req.destroy(new Error('Download: Zeitüberschreitung (keine Daten seit 60 s)')));
    req.on('error', reject);
  });
}

module.exports = { SyncEngine, HttpError, httpGet };
