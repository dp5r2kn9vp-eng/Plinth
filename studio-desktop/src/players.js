'use strict';
// Verbindung zu Plinth Playern im lokalen Netz: Suche (UDP-Broadcast), Kopplung, Übertragung, Umschalten.
// Protokoll: docs/offline.md (Gegenstück: player/src/offline.js, später auch der Android-Player).
const dgram = require('node:dgram');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const HTTP_PORT = 47800;
const DISCOVERY_PORT = 47801;
const DISCOVERY_MAGIC = 'PLINTH-SUCHE';

class PlayerError extends Error {
  constructor(status, code, message, body = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

/** Broadcast-Adressen aller Netzwerkkarten (plus 255.255.255.255). */
function broadcastAddresses() {
  const out = new Set(['255.255.255.255']);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal || !a.netmask) continue;
      const ip = a.address.split('.').map(Number);
      const mask = a.netmask.split('.').map(Number);
      out.add(ip.map((b, i) => (b | (~mask[i] & 255)) & 255).join('.'));
    }
  }
  return [...out];
}

/**
 * Sucht Player im Netz.
 * @returns {Promise<Array<object>>} Antworten (Info + host)
 */
function discover({ timeoutMs = 1500, port = DISCOVERY_PORT, targets = null } = {}) {
  return new Promise((resolve) => {
    const found = new Map();
    const sock = dgram.createSocket('udp4');
    let open = true;
    const finish = () => {
      if (!open) return;
      open = false;
      sock.close();
      resolve([...found.values()]);
    };
    sock.on('error', finish);
    sock.on('message', (msg, rinfo) => {
      try {
        const info = JSON.parse(msg.toString('utf8'));
        if (info.app !== 'plinth-player' || !info.deviceId) return;
        found.set(info.deviceId, { ...info, host: rinfo.address });
      } catch {
        // fremde Antwort
      }
    });
    sock.bind(0, () => {
      sock.setBroadcast(true);
      const msg = Buffer.from(DISCOVERY_MAGIC);
      const send = () => {
        if (!open) return;
        for (const addr of targets ?? broadcastAddresses()) sock.send(msg, port, addr, () => {});
      };
      send();
      setTimeout(send, Math.min(400, timeoutMs / 2)); // UDP kann verloren gehen
    });
    setTimeout(finish, timeoutMs);
  });
}

/** JSON-Anfrage an einen Player. */
function request(player, method, p, { body, token, timeoutMs = 15000, headers = {}, stream = null } = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({
      host: player.host,
      port: player.port || HTTP_PORT,
      method,
      path: p,
      headers: {
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let json = {};
        try {
          json = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        } catch {
          // kein JSON
        }
        if (res.statusCode >= 400) reject(new PlayerError(res.statusCode, json.error?.code ?? `http_${res.statusCode}`, json.error?.message ?? `HTTP ${res.statusCode}`, json));
        else resolve(json);
      });
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new PlayerError(0, 'timeout', 'Player antwortet nicht')));
    req.on('error', (e) => reject(e instanceof PlayerError ? e : new PlayerError(0, 'unreachable', `Player nicht erreichbar (${e.code ?? e.message})`)));
    if (stream) {
      stream.on('error', (e) => req.destroy(e));
      stream.pipe(req);
    } else {
      req.end(data ?? undefined);
    }
  });
}

const info = (player) => request(player, 'GET', '/plinth/v1/info', { timeoutMs: 4000 });

const pair = (player, { code, studio, studioId, name, pin }) =>
  request(player, 'POST', '/plinth/v1/koppeln', { body: { code, studio, studioId, name, pin } });

const settings = (player, values) => request(player, 'POST', '/plinth/v1/einstellungen', { body: values, token: player.token });

/**
 * Überträgt ein Manifest mit allen fehlenden Dateien und schaltet den Player um.
 * @param {object} player {host, port, token}
 * @param {object} manifest
 * @param {object} projekt {id, name}
 * @param {(sha:string)=>string} localFile  Pfad der Datei im Studio
 * @param {(p:{phase:string, done:number, total:number})=>void} onProgress
 */
async function deploy(player, manifest, projekt, localFile, onProgress = () => {}) {
  const files = [...new Map(manifest.files.map((f) => [f.path, f])).values()];
  onProgress({ phase: 'pruefen', done: 0, total: 0 });
  const { missing } = await request(player, 'POST', '/plinth/v1/pruefen', { body: { files }, token: player.token });
  const todo = missing.map((m) => ({ ...files.find((f) => f.path === m.path), offset: m.offset }));
  const total = todo.reduce((s, f) => s + f.size - f.offset, 0);
  let done = 0;
  onProgress({ phase: 'uebertragen', done, total });

  for (const f of todo) {
    const name = path.basename(f.path);
    const src = localFile(f.sha256, name);
    let offset = f.offset;
    for (let attempt = 1; offset < f.size; attempt++) {
      const before = offset;
      let sent = 0;
      const stream = fs.createReadStream(src, { start: offset });
      stream.on('data', (c) => {
        sent += c.length;
        onProgress({ phase: 'uebertragen', done: done + sent, total });
      });
      try {
        const res = await request(player, 'PUT', `/plinth/v1/medien/${name}?offset=${offset}`, {
          token: player.token,
          headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': f.size - offset, 'X-Plinth-Size': String(f.size) },
          stream,
          timeoutMs: 120000,
        });
        offset = res.offset;
      } catch (e) {
        stream.destroy();
        // Stand vom Player übernehmen (falscher Startpunkt, Abbruch, Prüfsumme) und erneut versuchen
        if (typeof e.body?.offset === 'number') offset = e.body.offset;
        if (attempt >= 5) throw e;
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
      done += Math.max(0, offset - before);
      onProgress({ phase: 'uebertragen', done, total });
    }
  }
  onProgress({ phase: 'umschalten', done: total, total });
  return request(player, 'POST', '/plinth/v1/aktivieren', { body: { manifest, projekt }, token: player.token, timeoutMs: 60000 });
}

module.exports = { discover, info, pair, settings, deploy, request, PlayerError, HTTP_PORT, DISCOVERY_PORT };
