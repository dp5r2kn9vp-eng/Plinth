// Medienbibliothek: Hochladen mit Fortschritt, Pause/Fortsetzen, Abbrechen; Standbild für Videos;
// Einfügen als Bild- oder Thumbnail-Element.

import { h, formatBytes, formatDuration, toast } from '../lib/dom.js';
import { patch, del } from '../lib/api.js';
import { uploadFile, cancelUpload, pendingUploads, forgetPending } from '../lib/uploader.js';
import { imageInfo, videoInfo } from '../lib/media.js';

const ACCEPT = 'image/jpeg,image/png,image/webp,video/mp4,video/webm';

export class Library {
  constructor(container, assets, { onInsert }) {
    this.container = container;
    this.assets = assets;
    this.onInsert = onInsert;
    this.jobs = new Map(); // key → job
    this.filter = 'alle';
    assets.addEventListener('change', () => this.render());
    this.render();
  }

  render() {
    const posters = this.assets.posterIds();
    const items = this.assets.list().filter((d) => !posters.has(d.id) && (this.filter === 'alle' || d.typ === this.filter));
    const input = h('input', { type: 'file', accept: ACCEPT, multiple: true, hidden: true, onchange: (e) => {
      this.addFiles([...e.target.files]);
      e.target.value = '';
    } });

    const drop = h('div.dropzone', {
      ondragover: (e) => {
        e.preventDefault();
        drop.classList.add('over');
      },
      ondragleave: () => drop.classList.remove('over'),
      ondrop: (e) => {
        e.preventDefault();
        drop.classList.remove('over');
        this.addFiles([...e.dataTransfer.files]);
      },
      onclick: () => input.click(),
    }, h('strong', {}, 'Dateien hochladen'), h('span.muted.small', {}, 'Klicken oder hierher ziehen · JPEG, PNG, WebP, MP4, WebM'));

    const pending = pendingUploads().filter((p) => ![...this.jobs.values()].some((j) => j.dateiId === p.dateiId));

    this.container.replaceChildren(...[
      h('div.lib-head', {},
        h('h2', {}, 'Medien'),
        h('div.seg', {}, ...['alle', 'video', 'bild'].map((f) => h(`button${this.filter === f ? '.on' : ''}`, { type: 'button', onclick: () => {
          this.filter = f;
          this.render();
        } }, { alle: 'Alle', video: 'Videos', bild: 'Bilder' }[f])))),
      drop, input,
      pending.length ? h('div.pending', {}, h('p.small', {}, 'Unterbrochene Uploads – dieselbe Datei erneut auswählen, um fortzusetzen:'),
        pending.map((p) => h('div.pending-item', {}, h('span', {}, `${p.name} (${formatBytes(p.groesse)})`),
          h('button.link', { type: 'button', onclick: async () => {
            await forgetPending(p);
            this.render();
          } }, 'verwerfen')))) : null,
      h('div.jobs', {}, [...this.jobs.values()].map((j) => this.jobView(j))),
      items.length ? h('div.lib-grid', {}, items.map((d) => this.itemView(d))) : h('p.muted.small.empty', {}, 'Noch keine Medien.'),
    ].filter(Boolean));
  }

  itemView(d) {
    const thumb = d.typ === 'video' ? this.assets.posterUrl(d.ref) : d.url;
    return h('div.lib-item', { title: d.name },
      h('div.lib-thumb', {}, thumb ? h('img', { src: thumb, alt: '', loading: 'lazy' }) : h('span.muted', {}, d.typ === 'video' ? '▶' : '🖼'),
        d.typ === 'video' ? h('span.badge', {}, formatDuration(d.dauerSekunden) || 'Video') : null),
      h('div.lib-name', {}, d.name),
      h('div.lib-meta.muted', {}, `${formatBytes(d.groesse)}${d.breite ? ` · ${d.breite}×${d.hoehe}` : ''}`),
      h('div.lib-actions', {},
        h('button.btn.sm.primary', { type: 'button', onclick: () => this.onInsert(d) }, 'Einfügen'),
        h('button.btn.sm', { type: 'button', title: 'Aus der Bibliothek entfernen', onclick: () => this.remove(d) }, '✕')));
  }

  jobView(j) {
    const pct = j.total ? Math.round((j.loaded / j.total) * 100) : 0;
    const status = {
      upload: `${pct} % · ${formatBytes(j.loaded)} von ${formatBytes(j.total)}${j.speed ? ` · ${formatBytes(j.speed)}/s` : ''}`,
      hash: 'Prüfsumme wird berechnet …',
      abschliessen: 'Wird abgeschlossen …',
      nachbearbeitung: 'Vorschau wird erzeugt …',
      pausiert: `Pausiert bei ${pct} %`,
      fehler: j.error ?? 'Fehler',
    }[j.phase] ?? '';
    return h(`div.job.${j.phase}`, {},
      h('div.job-name', {}, j.file.name),
      h('div.progress', {}, h('div', { style: { width: `${pct}%` } })),
      h('div.job-row', {}, h('span.small.muted', {}, status),
        h('span', {},
          j.phase === 'upload' ? h('button.link', { type: 'button', onclick: () => this.pause(j) }, 'Pause') : null,
          j.phase === 'pausiert' || j.phase === 'fehler' ? h('button.link', { type: 'button', onclick: () => this.start(j) }, 'Fortsetzen') : null,
          ['upload', 'pausiert', 'fehler'].includes(j.phase) ? h('button.link.danger', { type: 'button', onclick: () => this.cancel(j) }, 'Abbrechen') : null)));
  }

  addFiles(files) {
    for (const file of files) {
      if (!ACCEPT.split(',').includes(file.type)) {
        toast(`${file.name}: Format wird nicht unterstützt.`, 'error');
        continue;
      }
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (this.jobs.has(key)) continue;
      const job = { key, file, phase: 'upload', loaded: 0, total: file.size, dateiId: null };
      this.jobs.set(key, job);
      this.start(job);
    }
    this.render();
  }

  async start(job) {
    job.controller = new AbortController();
    job.phase = 'upload';
    job.error = null;
    let last = { t: performance.now(), b: job.loaded };
    this.render();
    try {
      const datei = await uploadFile(job.file, {
        signal: job.controller.signal,
        onProgress: (p) => {
          job.dateiId = p.dateiId;
          job.loaded = p.loaded;
          job.phase = p.phase;
          const now = performance.now();
          if (now - last.t > 1000) {
            job.speed = ((p.loaded - last.b) / (now - last.t)) * 1000;
            last = { t: now, b: p.loaded };
          }
          this.renderJobsThrottled();
        },
      });
      job.phase = 'nachbearbeitung';
      this.render();
      await this.postProcess(job.file, datei);
      this.jobs.delete(job.key);
      await this.assets.load();
      toast(`${job.file.name} hochgeladen.`, 'ok');
    } catch (e) {
      if (job.cancelled) return;
      job.phase = e.name === 'AbortError' ? 'pausiert' : 'fehler';
      job.error = e.message;
      this.render();
    }
  }

  renderJobsThrottled() {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      const box = this.container.querySelector('.jobs');
      if (box) box.replaceChildren(...[...this.jobs.values()].map((j) => this.jobView(j)));
    });
  }

  pause(job) {
    job.controller?.abort();
  }

  async cancel(job) {
    job.cancelled = true;
    job.controller?.abort();
    this.jobs.delete(job.key);
    await cancelUpload(job.file, job.dateiId);
    this.render();
  }

  /** Abmessungen, Dauer und Standbild ermitteln und speichern. */
  async postProcess(file, datei) {
    try {
      if (datei.typ === 'bild') {
        const info = await imageInfo(file);
        if (info) await patch(`/dateien/${datei.id}`, info);
        return;
      }
      const info = await videoInfo(file);
      if (!info) {
        toast(`${file.name}: Der Browser kann dieses Video nicht abspielen – vermutlich auch der Player nicht. Bitte als MP4 (H.264) exportieren.`, 'error', 10000);
        return;
      }
      const posterFile = new File([info.poster], `${file.name.replace(/\.[^.]+$/, '')}-vorschau.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
      const poster = await uploadFile(posterFile);
      await patch(`/dateien/${poster.id}`, { breite: Math.round(info.breite * Math.min(1, 1280 / info.breite)), hoehe: Math.round(info.hoehe * Math.min(1, 1280 / info.breite)) });
      await patch(`/dateien/${datei.id}`, { breite: info.breite, hoehe: info.hoehe, dauerSekunden: info.dauerSekunden, vorschauDateiId: poster.id });
    } catch (e) {
      toast(`Vorschau für ${file.name} fehlgeschlagen: ${e.message}`, 'error');
    }
  }

  async remove(d) {
    if (!confirm(`„${d.name}“ aus der Bibliothek entfernen? Bereits veröffentlichte Inhalte bleiben unverändert.`)) return;
    await del(`/dateien/${d.id}`);
    await this.assets.load();
  }
}
