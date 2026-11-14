// Multipart-Upload direkt in den Speicher: parallele Teile, Fortschritt, Pause/Wiederaufnahme, Abbruch.
// Ablauf: POST /uploads → signierte URLs je Teil (mit SHA-256 des Teils) → PUT in den Speicher → abschliessen.

import { post, get, del, ApiError } from './api.js';
import { sha256Base64 } from './sha256.js';

const PARALLEL = 3;
const RETRIES = 3;
const KEY_PREFIX = 'plinth-upload:';

const resumeKey = (file) => `${KEY_PREFIX}${file.name}:${file.size}:${file.lastModified}`;

function store(key, value) {
  try {
    value === null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // privater Modus o. ä.: ohne Wiederaufnahme weiter
  }
}

function load(key) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

/** Offene Uploads aus früheren Sitzungen (für den Hinweis "Upload fortsetzen"). */
export function pendingUploads() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(KEY_PREFIX)) out.push({ key: k, ...load(k) });
    }
  } catch {
    // ignorieren
  }
  return out;
}

function hashFile(file, onProgress) {
  const worker = new Worker(new URL('./hash-worker.js', import.meta.url), { type: 'module' });
  const promise = new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data.progress !== undefined) onProgress?.(data.progress);
      if (data.sha256) {
        resolve(data.sha256);
        worker.terminate();
      }
      if (data.error) {
        reject(new Error(data.error));
        worker.terminate();
      }
    };
    worker.onerror = (e) => {
      reject(new Error(e.message));
      worker.terminate();
    };
  });
  worker.postMessage(file);
  return { promise, cancel: () => worker.terminate() };
}

function storageError(message) {
  const e = new Error(message);
  e.storage = true;
  return e;
}

function putPart(url, blob, checksum, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    if (checksum) xhr.setRequestHeader('x-amz-checksum-sha256', checksum);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader('ETag');
        etag ? resolve(etag) : reject(storageError('Speicher liefert kein ETag (CORS: ETag freigeben).'));
      } else {
        // S3/R2 liefern den Grund als XML, z. B. <Code>BadDigest</Code>
        const code = /<Code>([^<]+)<\/Code>/.exec(xhr.responseText ?? '')?.[1];
        reject(storageError(`Speicher antwortet ${xhr.status}${code ? ` (${code})` : ''}`));
      }
    };
    xhr.onerror = () => reject(storageError('Speicher nicht erreichbar oder Anfrage blockiert (CORS?)'));
    xhr.onabort = () => reject(new DOMException('Abgebrochen', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(blob);
  });
}

/**
 * Lädt eine Datei hoch.
 * @param {File} file
 * @param {{onProgress?: (p: {phase: string, loaded: number, total: number, hashed: number}) => void, signal?: AbortSignal}} opts
 * @returns {Promise<object>} die fertige Datei aus der API
 */
export async function uploadFile(file, { onProgress, signal } = {}) {
  const key = resumeKey(file);
  let info = null;
  let done = new Map(); // Teilnummer → ETag

  const saved = load(key);
  if (saved?.dateiId) {
    try {
      info = await get(`/uploads/${saved.dateiId}`);
      for (const t of info.upload.fertigeTeile) done.set(t.nummer, t.etag);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status >= 500) throw e;
      store(key, null); // Upload gibt es nicht mehr → neu beginnen
      info = null;
    }
  }
  if (!info) {
    info = await post('/uploads', { name: file.name, mime: file.type, groesse: file.size });
    store(key, { dateiId: info.datei.id, name: file.name, groesse: file.size });
  }

  const id = info.datei.id;
  const { teilGroesse, teileAnzahl } = info.upload;
  const partSize = (n) => Math.min(teilGroesse, file.size - (n - 1) * teilGroesse);
  const inFlight = new Map();
  let hashed = 0;
  const loaded = () => [...done.keys()].reduce((s, n) => s + partSize(n), 0) + [...inFlight.values()].reduce((a, b) => a + b, 0);
  const report = (phase) => onProgress?.({ phase, loaded: loaded(), total: file.size, hashed, dateiId: id });

  const hasher = hashFile(file, (p) => {
    hashed = p;
    report('upload');
  });
  signal?.addEventListener('abort', () => hasher.cancel(), { once: true });

  const queue = [];
  for (let n = 1; n <= teileAnzahl; n++) if (!done.has(n)) queue.push(n);

  const worker = async () => {
    while (queue.length) {
      if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError');
      const n = queue.shift();
      const blob = file.slice((n - 1) * teilGroesse, (n - 1) * teilGroesse + partSize(n));
      const checksum = await sha256Base64(await blob.arrayBuffer());
      let storageErr = null; // erster Fehler des Speichers; spätere API-Fehler beim Neuversuch sollen ihn nicht verdecken
      for (let attempt = 1; ; attempt++) {
        try {
          const { urls, pruefsummen } = await post(`/uploads/${id}/teile`, { teile: [n], pruefsummen: { [n]: checksum } });
          const etag = await putPart(urls[n], blob, pruefsummen ? checksum : null, (b) => {
            inFlight.set(n, b);
            report('upload');
          }, signal);
          inFlight.delete(n);
          done.set(n, etag);
          report('upload');
          break;
        } catch (e) {
          inFlight.delete(n);
          if (e.storage) storageErr ??= e;
          if (e.name === 'AbortError') throw e;
          if (attempt >= RETRIES) throw storageErr ?? e;
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    }
  };

  report('upload');
  await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length || 1) }, worker));
  report('hash');
  const sha256 = await hasher.promise;
  report('abschliessen');
  const teile = [...done.entries()].map(([nummer, etag]) => ({ nummer, etag }));
  const { datei } = await post(`/uploads/${id}/abschliessen`, { teile, sha256 });
  store(key, null);
  return datei;
}

/** Upload endgültig abbrechen (Teile im Speicher werden verworfen). */
export async function cancelUpload(file, dateiId) {
  store(resumeKey(file), null);
  if (dateiId) await del(`/uploads/${dateiId}`).catch(() => {});
}

export async function forgetPending(entry) {
  store(entry.key, null);
  if (entry.dateiId) await del(`/uploads/${entry.dateiId}`).catch(() => {});
}
