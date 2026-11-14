// Medienbibliothek im Speicher des Browsers: Datei-Ref ("f12") → Datei mit signierter URL.

import { get } from '../lib/api.js';

export class Assets extends EventTarget {
  constructor() {
    super();
    this.byRef = new Map();
    this.byId = new Map();
    this.loadedAt = 0;
  }

  async load() {
    const { dateien } = await get('/dateien');
    this.byRef = new Map(dateien.map((d) => [d.ref, d]));
    this.byId = new Map(dateien.map((d) => [d.id, d]));
    this.loadedAt = Date.now();
    this.dispatchEvent(new Event('change'));
  }

  /** Signierte URLs laufen nach 1 h ab – vorher neu laden. */
  async refreshIfStale() {
    if (Date.now() - this.loadedAt > 45 * 60 * 1000) await this.load();
  }

  list(typ) {
    return [...this.byRef.values()].filter((d) => !typ || d.typ === typ);
  }

  get(ref) {
    return this.byRef.get(ref) ?? null;
  }

  url(ref) {
    return this.byRef.get(ref)?.url ?? null;
  }

  /** Vorschaubild eines Videos (automatisch erzeugtes Standbild) */
  posterUrl(videoRef) {
    const v = this.byRef.get(videoRef);
    return v?.vorschauDateiId ? this.byId.get(v.vorschauDateiId)?.url ?? null : null;
  }

  /** IDs von Bildern, die nur als Standbild eines Videos dienen (in der Bibliothek ausgeblendet). */
  posterIds() {
    return new Set(this.list('video').map((v) => v.vorschauDateiId).filter(Boolean));
  }
}
