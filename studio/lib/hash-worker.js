// Berechnet SHA-256 einer (auch mehrere GB großen) Datei im Hintergrund.
import { Sha256 } from './sha256.js';

const CHUNK = 8 * 1024 * 1024;

self.onmessage = async ({ data: file }) => {
  try {
    const hash = new Sha256();
    for (let pos = 0; pos < file.size; pos += CHUNK) {
      const buf = new Uint8Array(await file.slice(pos, pos + CHUNK).arrayBuffer());
      hash.update(buf);
      self.postMessage({ progress: Math.min(1, (pos + buf.length) / file.size) });
    }
    self.postMessage({ sha256: hash.digestHex() });
  } catch (e) {
    self.postMessage({ error: String(e?.message ?? e) });
  }
};
