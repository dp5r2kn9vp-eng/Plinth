'use strict';
// Lokaler Server von Plinth Studio Desktop.
// Bietet dieselbe /api/v1 wie der Cloud-Server (soweit das Studio sie nutzt), damit die Studio-Oberfläche
// unverändert läuft, und zusätzlich /api/v1/offline/* für Player im lokalen Netz.
// Lauscht nur auf 127.0.0.1 und prüft den Host-Header (Schutz gegen DNS-Rebinding aus dem Browser).
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { Db } = require('./db');
const players = require('./players');

const ERLAUBT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm' };
const TEIL = 16 * 1024 * 1024;
const MAX_BYTES = 50 * 1024 ** 3;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

class ApiError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
const validation = (errors) => new ApiError(422, 'validation', 'Eingaben sind ungültig.', { errors });
const notFound = (m = 'Nicht gefunden.') => new ApiError(404, 'not_found', m);

function startLayout(ausrichtung) {
  const [w, h] = ausrichtung === 'portrait' ? [1080, 1920] : [1920, 1080];
  return {
    schemaVersion: 1,
    format: { orientation: ausrichtung, width: w, height: h },
    idleTimeoutSeconds: 120,
    pages: [{ id: 'home', name: 'Startseite', background: { color: '#0e1116' }, elements: [] }],
    videoPage: { background: '#000000', fit: 'contain', header: { height: 110, background: '#151a22', color: '#ffffff', backLabel: 'Zurück', showTitle: true, fontSize: 40 } },
  };
}

function referencedAssets(layout) {
  const refs = [];
  for (const page of layout.pages ?? []) {
    if (page.background?.image) refs.push(page.background.image);
    for (const el of page.elements ?? []) {
      for (const k of ['image', 'video', 'poster']) if (typeof el[k] === 'string') refs.push(el[k]);
      if (el.action?.type === 'openVideo') refs.push(el.action.video);
    }
  }
  return [...new Set(refs)];
}

const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

/**
 * @param {object} o
 * @param {string} o.dataDir   Projekte, Medien, Einstellungen
 * @param {string} o.studioDir Studio-Oberfläche (statisch)
 * @param {string} o.sharedDir Renderer und Schemas
 * @param {string} [o.version]
 * @param {object} [o.playerOptions] für Tests: {discoveryPort, discoveryTargets}
 */
function createStudioServer(o) {
  const db = new Db(o.dataDir);
  const mediaDir = path.join(o.dataDir, 'medien');
  const uploadDir = path.join(o.dataDir, 'uploads');
  fs.mkdirSync(mediaDir, { recursive: true });
  fs.mkdirSync(uploadDir, { recursive: true });
  if (!db.data.einstellungen.studioId) {
    db.data.einstellungen.studioId = crypto.randomUUID();
    db.save();
  }
  const validate = schemaValidators(path.join(o.sharedDir, 'schemas'));
  const jobs = new Map(); // Verteilungen
  let port = 0;

  // ---------------------------------------------------------- Hilfen

  const projekt = (id) => db.data.projekte.find((p) => p.id === Number(id)) ?? (() => {
    throw notFound('Projekt nicht gefunden.');
  })();
  const presentProjekt = (p) => {
    const revs = db.data.revisionen[p.id] ?? [];
    return { id: p.id, name: p.name, ausrichtung: p.ausrichtung, revision: revs.length ? revs[revs.length - 1].nummer : null, entwurfAm: db.data.entwuerfe[p.id]?.aktualisiertAm ?? null };
  };
  const datei = (id) => db.data.dateien.find((d) => d.id === Number(id) && !d.geloeschtAm) ?? (() => {
    throw notFound('Datei nicht gefunden.');
  })();
  const mediaName = (d) => `${d.sha256}.${ERLAUBT[d.mime]}`;
  const presentDatei = (d) => ({
    id: d.id, ref: `f${d.id}`, name: d.name, mime: d.mime, typ: d.mime.startsWith('video/') ? 'video' : 'bild', groesse: d.groesse,
    sha256: d.sha256, status: d.status, breite: d.breite ?? null, hoehe: d.hoehe ?? null, dauerSekunden: d.dauerSekunden ?? null,
    vorschauDateiId: d.vorschauDateiId ?? null, erstelltAm: d.erstelltAm,
    ...(d.status === 'fertig' ? { url: `/medien/${mediaName(d)}` } : {}),
  });
  const teileAnzahl = (groesse) => Math.max(1, Math.ceil(groesse / TEIL));
  const uploadInfo = (d) => ({ datei: presentDatei(d), upload: { teilGroesse: TEIL, teileAnzahl: teileAnzahl(d.groesse) } });
  const partDir = (d) => path.join(uploadDir, String(d.id));
  const partSize = (d, n) => Math.min(TEIL, d.groesse - (n - 1) * TEIL);
  const fertigeTeile = (d) => {
    const out = [];
    for (let n = 1; n <= teileAnzahl(d.groesse); n++) {
      try {
        if (fs.statSync(path.join(partDir(d), String(n))).size === partSize(d, n)) out.push({ nummer: n, etag: `"${n}-${partSize(d, n)}"` });
      } catch {
        // fehlt
      }
    }
    return out;
  };
  const uploadDatei = (id) => {
    const d = datei(id);
    if (d.status !== 'upload') throw new ApiError(409, 'upload_closed', 'Für diese Datei läuft kein Upload.');
    return d;
  };

  // ---------------------------------------------------------- Routen

  const routes = [];
  const route = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn });

  route('GET', '/api/v1/health', () => ({ status: 'ok', version: o.version ?? 'dev', modus: 'offline' }));
  route('GET', '/api/v1/auth/me', () => ({ user: { id: 1, name: os.hostname(), email: null }, modus: 'offline' }));
  route('POST', '/api/v1/auth/logout', () => null);
  route('GET', '/api/v1/kunde', () => ({ kunde: { id: 1, name: 'Lokal', kundencode: null }, modus: 'offline' }));

  // Projekte und Entwürfe
  route('GET', '/api/v1/projekte', () => ({ projekte: db.data.projekte.map(presentProjekt) }));
  route('POST', '/api/v1/projekte', ({ body }) => {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const errors = {};
    if (!name || name.length > 190) errors.name = 'Name fehlt oder ist zu lang.';
    if (!['landscape', 'portrait'].includes(body.ausrichtung)) errors.ausrichtung = 'landscape oder portrait.';
    if (Object.keys(errors).length) throw validation(errors);
    const p = { id: db.nextId('projekt'), name, ausrichtung: body.ausrichtung };
    db.data.projekte.push(p);
    db.data.entwuerfe[p.id] = { layout: startLayout(p.ausrichtung), version: 1, aktualisiertAm: now() };
    db.save();
    return [201, { projekt: presentProjekt(p) }];
  });
  route('PATCH', '/api/v1/projekte/:id', ({ params, body }) => {
    const p = projekt(params.id);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 190) throw validation({ name: 'Name fehlt oder ist zu lang.' });
    p.name = name;
    db.save();
    return { projekt: presentProjekt(p) };
  });
  route('GET', '/api/v1/projekte/:id/entwurf', ({ params }) => {
    const p = projekt(params.id);
    db.data.entwuerfe[p.id] ??= { layout: startLayout(p.ausrichtung), version: 1, aktualisiertAm: now() };
    return db.data.entwuerfe[p.id];
  });
  route('PUT', '/api/v1/projekte/:id/entwurf', ({ params, body }) => {
    const p = projekt(params.id);
    const errors = validate.layout(body.layout);
    if (errors.length) throw new ApiError(422, 'invalid_layout', 'Layout ist ungültig.', { errors });
    const cur = db.data.entwuerfe[p.id];
    if (cur && cur.version !== body.version) throw new ApiError(409, 'draft_conflict', 'Der Entwurf wurde inzwischen an anderer Stelle geändert.', { version: cur.version });
    db.data.entwuerfe[p.id] = { layout: body.layout, version: (cur?.version ?? 0) + 1, aktualisiertAm: now() };
    p.ausrichtung = body.layout.format.orientation;
    db.save();
    return db.data.entwuerfe[p.id];
  });
  route('POST', '/api/v1/projekte/:id/veroeffentlichen', ({ params }) => {
    const p = projekt(params.id);
    const revision = publish(p);
    return [201, { revision }];
  });
  route('GET', '/api/v1/projekte/:id/revisionen', ({ params }) => {
    const p = projekt(params.id);
    return { revisionen: [...(db.data.revisionen[p.id] ?? [])].reverse().map((r) => ({ nummer: r.nummer, status: 'aktiv', veroeffentlichtAm: r.veroeffentlichtAm, von: os.hostname() })) };
  });

  // Uploads (gleiches Protokoll wie in der Cloud, Teile landen lokal)
  route('POST', '/api/v1/uploads', ({ body }) => {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const mime = typeof body.mime === 'string' ? body.mime.toLowerCase() : '';
    const errors = {};
    if (!name || name.length > 255) errors.name = 'Dateiname fehlt oder ist zu lang.';
    if (!ERLAUBT[mime]) errors.mime = 'Erlaubt sind JPEG, PNG, WebP, MP4 und WebM.';
    if (!Number.isSafeInteger(body.groesse) || body.groesse < 1 || body.groesse > MAX_BYTES) errors.groesse = 'Ungültige Größe.';
    if (Object.keys(errors).length) throw validation(errors);
    const d = { id: db.nextId('datei'), name, mime, groesse: body.groesse, sha256: null, status: 'upload', erstelltAm: now() };
    db.data.dateien.push(d);
    db.save();
    fs.mkdirSync(partDir(d), { recursive: true });
    return [201, uploadInfo(d)];
  });
  route('GET', '/api/v1/uploads/:id', ({ params }) => {
    const d = uploadDatei(params.id);
    const info = uploadInfo(d);
    info.upload.fertigeTeile = fertigeTeile(d);
    return info;
  });
  route('POST', '/api/v1/uploads/:id/teile', ({ params, body }) => {
    const d = uploadDatei(params.id);
    const nums = Array.isArray(body.teile) ? body.teile : [];
    if (!nums.length || nums.some((n) => !Number.isInteger(n) || n < 1 || n > teileAnzahl(d.groesse))) throw validation({ teile: `Teilnummern von 1 bis ${teileAnzahl(d.groesse)}.` });
    return { urls: Object.fromEntries(nums.map((n) => [n, `/api/v1/_teil/${d.id}/${n}`])), pruefsummen: false };
  });
  route('PUT', '/api/v1/_teil/:id/:n', async ({ params, req }) => {
    const d = uploadDatei(params.id);
    const n = Number(params.n);
    if (!Number.isInteger(n) || n < 1 || n > teileAnzahl(d.groesse)) throw notFound();
    const target = path.join(partDir(d), String(n));
    const tmp = `${target}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    await pipeline(req, fs.createWriteStream(tmp));
    if (fs.statSync(tmp).size !== partSize(d, n)) {
      fs.rmSync(tmp, { force: true });
      throw new ApiError(400, 'part_size', 'Teil hat die falsche Größe.');
    }
    fs.renameSync(tmp, target);
    return { _etag: `"${n}-${partSize(d, n)}"` };
  });
  route('POST', '/api/v1/uploads/:id/abschliessen', async ({ params, body }) => {
    const d = uploadDatei(params.id);
    const sha = typeof body.sha256 === 'string' ? body.sha256.toLowerCase() : '';
    if (!/^[a-f0-9]{64}$/.test(sha)) throw validation({ sha256: 'SHA-256 der ganzen Datei als Hex angeben.' });
    if (fertigeTeile(d).length !== teileAnzahl(d.groesse)) throw new ApiError(409, 'upload_incomplete', 'Upload konnte nicht abgeschlossen werden. Fehlende Teile erneut hochladen.');
    const tmp = path.join(uploadDir, `${d.id}.zusammen`);
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(tmp);
    for (let n = 1; n <= teileAnzahl(d.groesse); n++) {
      for await (const chunk of fs.createReadStream(path.join(partDir(d), String(n)))) {
        hash.update(chunk);
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      }
    }
    await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
    const actual = hash.digest('hex');
    if (actual !== sha) {
      fs.rmSync(tmp, { force: true });
      throw new ApiError(422, 'checksum', 'Prüfsumme stimmt nicht. Bitte die Datei erneut hochladen.');
    }
    d.sha256 = sha;
    const final = path.join(mediaDir, mediaName(d));
    if (fs.existsSync(final)) fs.rmSync(tmp, { force: true });
    else fs.renameSync(tmp, final);
    fs.rmSync(partDir(d), { recursive: true, force: true });
    d.status = 'fertig';
    db.save();
    return { datei: presentDatei(d) };
  });
  route('DELETE', '/api/v1/uploads/:id', ({ params }) => {
    const d = uploadDatei(params.id);
    fs.rmSync(partDir(d), { recursive: true, force: true });
    db.data.dateien = db.data.dateien.filter((x) => x !== d);
    db.save();
    return null;
  });

  // Dateien
  route('GET', '/api/v1/dateien', () => ({ dateien: db.data.dateien.filter((d) => d.status === 'fertig' && !d.geloeschtAm).reverse().map(presentDatei) }));
  route('GET', '/api/v1/dateien/:id', ({ params }) => ({ datei: presentDatei(datei(params.id)) }));
  route('PATCH', '/api/v1/dateien/:id', ({ params, body }) => {
    const d = datei(params.id);
    const errors = {};
    if ('name' in body) (typeof body.name === 'string' && body.name.trim() && body.name.length <= 255) ? (d.name = body.name.trim()) : (errors.name = 'Ungültiger Name.');
    for (const k of ['breite', 'hoehe']) if (k in body) (Number.isInteger(body[k]) && body[k] > 0 && body[k] < 100000) ? (d[k] = body[k]) : (errors[k] = 'Positive ganze Zahl.');
    if ('dauerSekunden' in body) (typeof body.dauerSekunden === 'number' && body.dauerSekunden >= 0) ? (d.dauerSekunden = body.dauerSekunden) : (errors.dauerSekunden = 'Zahl ≥ 0.');
    if ('vorschauDateiId' in body) {
      const v = body.vorschauDateiId === null ? null : db.data.dateien.find((x) => x.id === body.vorschauDateiId && x.status === 'fertig' && x.mime.startsWith('image/'));
      if (body.vorschauDateiId !== null && (!v || !d.mime.startsWith('video/'))) errors.vorschauDateiId = 'Muss ein eigenes, fertiges Bild sein.';
      else d.vorschauDateiId = v ? v.id : null;
    }
    if (Object.keys(errors).length) throw validation(errors);
    db.save();
    return { datei: presentDatei(d) };
  });
  route('DELETE', '/api/v1/dateien/:id', ({ params }) => {
    const d = datei(params.id);
    d.geloeschtAm = now(); // Inhalt bleibt für veröffentlichte Stände erhalten
    db.save();
    return null;
  });

  // ---------------------------------------------------------- Veröffentlichen

  function publish(p) {
    const draft = db.data.entwuerfe[p.id];
    const layout = structuredClone(draft.layout);
    const errors = validate.layout(layout);
    if (errors.length) throw new ApiError(422, 'invalid_layout', 'Der Entwurf ist ungültig.', { errors });
    // Standbild automatisch einsetzen
    for (const page of layout.pages) {
      for (const el of page.elements) {
        if (el.type === 'thumbnail' && !el.poster) {
          const v = db.data.dateien.find((d) => `f${d.id}` === el.video);
          if (v?.vorschauDateiId) el.poster = `f${v.vorschauDateiId}`;
        }
      }
    }
    const problems = {};
    const files = [];
    for (const ref of referencedAssets(layout)) {
      const d = db.data.dateien.find((x) => `f${x.id}` === ref && !x.geloeschtAm);
      if (!d) problems[ref] = 'Datei gibt es nicht (mehr).';
      else if (d.status !== 'fertig') problems[ref] = `„${d.name}“ wird noch hochgeladen.`;
      else if (!fs.existsSync(path.join(mediaDir, mediaName(d)))) problems[ref] = `„${d.name}“ fehlt auf diesem Computer.`;
      else files.push({ id: ref, path: `media/${mediaName(d)}`, size: d.groesse, sha256: d.sha256, mime: d.mime });
    }
    if (Object.keys(problems).length) throw new ApiError(422, 'files_not_ready', 'Nicht alle Dateien sind bereit.', { dateien: problems });
    const revs = (db.data.revisionen[p.id] ??= []);
    const nummer = (revs.length ? revs[revs.length - 1].nummer : 0) + 1;
    const manifest = { schemaVersion: 1, revision: nummer, publishedAt: now(), validFrom: null, validTo: null, priority: 0, layout, files };
    const merrors = validate.manifest(manifest);
    if (merrors.length) throw new ApiError(422, 'invalid_manifest', 'Manifest ist ungültig.', { errors: merrors });
    revs.push({ nummer, manifest, veroeffentlichtAm: manifest.publishedAt });
    db.save();
    return { nummer, veroeffentlichtAm: manifest.publishedAt, dateien: files.length, groesse: files.reduce((s, f) => s + f.size, 0) };
  }

  // ---------------------------------------------------------- Player im lokalen Netz

  const presentPlayer = (pl, live) => ({
    id: pl.id, deviceId: pl.deviceId, name: pl.name, host: pl.host, port: pl.port, projektId: pl.projektId ?? null,
    online: !!live, stand: live?.projekt ?? pl.stand ?? null, version: live?.version ?? pl.version ?? null,
    plattform: live?.platform ?? pl.plattform ?? null, zuletztGesehenAm: pl.zuletztGesehenAm ?? null,
  });
  const playerById = (id) => db.data.player.find((x) => x.id === Number(id)) ?? (() => {
    throw notFound('Player nicht gefunden.');
  })();
  const discoverOpts = () => ({ port: o.playerOptions?.discoveryPort, targets: o.playerOptions?.discoveryTargets, timeoutMs: o.playerOptions?.discoveryMs ?? 1500 });

  /** Aktuellen Zustand aller gekoppelten Player abfragen; geänderte IP-Adressen über die Suche nachführen. */
  async function refreshPlayers(found = null) {
    const list = found ?? await players.discover(discoverOpts());
    let changed = false;
    const live = await Promise.all(db.data.player.map(async (pl) => {
      const seen = list.find((f) => f.deviceId === pl.deviceId);
      if (seen && (seen.host !== pl.host || seen.port !== pl.port)) {
        Object.assign(pl, { host: seen.host, port: seen.port });
        changed = true;
      }
      const inf = await players.info(pl).catch(() => null);
      if (inf && inf.deviceId === pl.deviceId) {
        Object.assign(pl, { zuletztGesehenAm: now(), stand: inf.projekt, version: inf.version, plattform: inf.platform });
        changed = true;
        return inf;
      }
      return null;
    }));
    if (changed) db.save();
    return { live, list };
  }

  route('GET', '/api/v1/offline/player', async () => {
    const { live, list } = await refreshPlayers();
    const known = new Set(db.data.player.map((p) => p.deviceId));
    return {
      player: db.data.player.map((pl, i) => presentPlayer(pl, live[i])),
      gefunden: list.filter((f) => !known.has(f.deviceId)).map((f) => ({ deviceId: f.deviceId, name: f.name, host: f.host, port: f.port, version: f.version, plattform: f.platform, gekoppelt: f.paired })),
      einstellungen: { pinGesetzt: !!db.data.einstellungen.pin },
    };
  });

  route('POST', '/api/v1/offline/player', async ({ body }) => {
    const host = String(body.host ?? '').trim();
    const port = Number(body.port) || players.HTTP_PORT;
    const code = String(body.code ?? '').replace(/\D/g, '');
    if (!host || !/^[\w.:-]+$/.test(host)) throw validation({ host: 'IP-Adresse oder Rechnername angeben.' });
    if (!/^\d{6}$/.test(code)) throw validation({ code: 'Der Kopplungscode hat 6 Ziffern (steht auf dem Bildschirm des Players).' });
    const target = { host, port };
    let res;
    try {
      res = await players.pair(target, {
        code,
        studio: os.hostname(),
        studioId: db.data.einstellungen.studioId,
        name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : undefined,
        pin: db.data.einstellungen.pin ?? undefined,
      });
    } catch (e) {
      if (e.code === 'invalid_code') throw new ApiError(422, 'invalid_code', 'Kopplungscode ist falsch.');
      if (e.code === 'locked') throw new ApiError(429, 'locked', e.message);
      throw new ApiError(502, 'unreachable', `Player unter ${host} nicht erreichbar. Läuft er und ist er im selben Netz?`);
    }
    let pl = db.data.player.find((x) => x.deviceId === res.deviceId);
    if (!pl) {
      pl = { id: db.nextId('player'), deviceId: res.deviceId, projektId: null };
      db.data.player.push(pl);
    }
    Object.assign(pl, { name: res.name, host, port, token: res.token, zuletztGesehenAm: now(), version: res.version, plattform: res.platform, stand: res.projekt });
    db.save();
    return [201, { player: presentPlayer(pl, res) }];
  });

  route('PATCH', '/api/v1/offline/player/:id', async ({ params, body }) => {
    const pl = playerById(params.id);
    if ('projektId' in body) {
      if (body.projektId !== null) projekt(body.projektId);
      pl.projektId = body.projektId;
    }
    if (typeof body.name === 'string' && body.name.trim()) {
      pl.name = body.name.trim().slice(0, 100);
      await players.settings(pl, { name: pl.name }).catch(() => {}); // Player offline: Name wird beim nächsten Verteilen übertragen
    }
    db.save();
    return { player: presentPlayer(pl, null) };
  });

  route('DELETE', '/api/v1/offline/player/:id', ({ params }) => {
    const pl = playerById(params.id);
    db.data.player = db.data.player.filter((x) => x !== pl);
    db.save();
    return null;
  });

  route('PUT', '/api/v1/offline/einstellungen', async ({ body }) => {
    const pin = String(body.pin ?? '');
    if (!/^\d{4,8}$/.test(pin)) throw validation({ pin: 'PIN muss 4 bis 8 Ziffern haben.' });
    db.data.einstellungen.pin = pin;
    db.save();
    const results = await Promise.all(db.data.player.map((pl) => players.settings(pl, { pin }).then(() => true, () => false)));
    return { uebertragen: results.filter(Boolean).length, gesamt: results.length };
  });

  // Verteilen: neuesten Stand eines Projekts an die zugeordneten Player schicken
  route('POST', '/api/v1/offline/verteilen', async ({ body }) => {
    const p = projekt(body.projektId);
    const revs = db.data.revisionen[p.id] ?? [];
    if (!revs.length) throw new ApiError(409, 'not_published', 'Dieses Projekt wurde noch nicht veröffentlicht.');
    const rev = revs[revs.length - 1];
    const first = db.data.projekte[0]?.id;
    const ids = Array.isArray(body.playerIds) ? body.playerIds.map(Number) : null;
    const targets = db.data.player.filter((pl) => (ids ? ids.includes(pl.id) : (pl.projektId ?? first) === p.id));
    const job = { id: crypto.randomUUID(), projektId: p.id, revision: rev.nummer, gestartet: now(), fertig: false, player: {} };
    for (const pl of targets) job.player[pl.id] = { name: pl.name, phase: 'warten', done: 0, total: 0, fehler: null };
    jobs.set(job.id, job);
    if (targets.length) await refreshPlayers().catch(() => {});
    Promise.all(targets.map(async (pl) => {
      const st = job.player[pl.id];
      try {
        await players.deploy(pl, rev.manifest, { id: p.id, name: p.name }, (_sha, name) => path.join(mediaDir, name), (pr) => Object.assign(st, pr));
        st.phase = 'fertig';
        pl.stand = { id: p.id, name: p.name, revision: rev.nummer };
        pl.zuletztGesehenAm = now();
        if (db.data.einstellungen.pin) await players.settings(pl, { pin: db.data.einstellungen.pin, name: pl.name }).catch(() => {});
      } catch (e) {
        st.phase = 'fehler';
        st.fehler = e.code === 'not_paired' ? 'Kopplung ungültig – Player neu koppeln.' : e.message;
      }
    })).finally(() => {
      job.fertig = true;
      db.save();
      setTimeout(() => jobs.delete(job.id), 60 * 60 * 1000).unref();
    });
    return [202, { verteilung: job }];
  });

  route('GET', '/api/v1/offline/verteilen/:id', ({ params }) => {
    const job = jobs.get(params.id);
    if (!job) throw notFound('Verteilung nicht gefunden.');
    return { verteilung: job };
  });

  // ---------------------------------------------------------- HTTP

  async function handle(req, res) {
    const host = (req.headers.host ?? '').toLowerCase();
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      res.writeHead(403).end();
      return;
    }
    const url = new URL(req.url, `http://${host}`);
    const p = decodeURIComponent(url.pathname);

    if (p === '/' || p === '/studio' || p === '/studio/login.html') {
      res.writeHead(302, { Location: '/studio/' }).end();
      return;
    }
    if (p.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store');
      for (const r of routes) {
        const m = r.method === req.method && r.re.exec(p);
        if (!m) continue;
        try {
          const body = ['POST', 'PUT', 'PATCH'].includes(req.method) && !p.startsWith('/api/v1/_teil/') ? await readJson(req) : {};
          let out = await r.fn({ params: m.groups ?? {}, body, req, query: url.searchParams });
          let status = 200;
          if (Array.isArray(out)) [status, out] = out;
          if (out === null) {
            res.writeHead(204).end();
          } else if (out._etag) {
            res.writeHead(200, { ETag: out._etag }).end();
          } else {
            sendJson(res, status, out);
          }
        } catch (e) {
          if (e instanceof ApiError) sendJson(res, e.status, { error: { code: e.code, message: e.message, details: e.details } });
          else {
            o.log?.error?.(`API-Fehler ${req.method} ${p}: ${e.stack ?? e}`);
            sendJson(res, 500, { error: { code: 'internal', message: e.message } });
          }
        }
        return;
      }
      sendJson(res, 404, { error: { code: 'not_found', message: 'Unbekannter Pfad' } });
      return;
    }
    if (p.startsWith('/medien/')) return serveFile(req, res, mediaDir, p.slice('/medien/'.length));
    if (p.startsWith('/studio/')) return serveFile(req, res, o.studioDir, p.slice('/studio/'.length) || 'index.html');
    if (p.startsWith('/shared/')) return serveFile(req, res, o.sharedDir, p.slice('/shared/'.length));
    res.writeHead(404).end();
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      if (!res.headersSent) res.writeHead(500).end(String(e.message));
    });
  });
  server.requestTimeout = 0;

  return {
    server,
    db,
    async listen(wanted = 0) {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(wanted, '127.0.0.1', resolve);
      });
      port = server.address().port;
      return port;
    },
    close: () => new Promise((r) => {
      server.closeAllConnections?.();
      server.close(() => r());
    }),
  };
}

function sendJson(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length });
  res.end(data);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 16 * 1024 * 1024) throw new ApiError(413, 'too_large', 'Anfrage zu groß.');
    chunks.push(c);
  }
  if (!size) return {};
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return v && typeof v === 'object' ? v : {};
  } catch {
    throw new ApiError(400, 'invalid_json', 'Ungültiges JSON.');
  }
}

/** Statische Datei mit Range-Unterstützung (Videos). */
function serveFile(req, res, base, rel) {
  const file = path.resolve(base, rel);
  if (!file.startsWith(path.resolve(base) + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  let stat;
  try {
    stat = fs.statSync(file);
    if (stat.isDirectory()) return serveFile(req, res, base, path.join(rel, 'index.html'));
  } catch {
    res.writeHead(404).end();
    return;
  }
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : stat.size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : stat.size - 1;
    start = Math.max(0, start);
    end = Math.min(stat.size - 1, end);
    if (start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end();
      return;
    }
    res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
  if (req.method === 'HEAD') res.end();
  else fs.createReadStream(file).pipe(res);
}

/** JSON-Schema-Prüfung mit denselben Schemas wie die Cloud-API. */
function schemaValidators(dir) {
  const Ajv2020 = require('ajv/dist/2020').default;
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  const layout = JSON.parse(fs.readFileSync(path.join(dir, 'layout.schema.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.schema.json'), 'utf8'));
  ajv.addSchema(layout);
  ajv.addSchema(manifest);
  const fmt = (errors) => (errors ?? []).slice(0, 20).map((e) => `${e.instancePath || '/'}: ${e.message}`);
  const vl = ajv.getSchema(layout.$id);
  const vm = ajv.getSchema(manifest.$id);
  return {
    layout: (data) => (vl(data) ? [] : fmt(vl.errors)),
    manifest: (data) => (vm(data) ? [] : fmt(vm.errors)),
  };
}

module.exports = { createStudioServer, startLayout, referencedAssets };
