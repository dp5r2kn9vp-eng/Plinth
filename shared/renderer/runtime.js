// Ablauf eines Layouts: Startseite → Seiten/Video → zurück, Inaktivitäts-Timeout.
// Wird von der Studio-Vorschau und vom Player gleich verwendet, damit sich beide identisch verhalten.

import { createStage, renderPage, renderVideoPage } from './renderer.js';

export class PlinthRuntime {
  /**
   * @param {HTMLElement} container
   * @param {object} options
   * @param {object} options.layout          Layout nach shared/schemas/layout.schema.json
   * @param {(ref: string) => string|null} options.asset     URL einer Datei
   * @param {(videoRef: string) => string|null} [options.poster]  Vorschaubild eines Videos (falls im Layout keins steht)
   * @param {boolean} [options.muted]
   * @param {(event: string, detail?: object) => void} [options.onEvent]  'page', 'video', 'idle', 'error'
   */
  constructor(container, options) {
    this.container = container;
    this.options = options;
    this.layout = options.layout;
    this.history = [];
    this.pageId = null;
    this.video = null;
    this.pending = null;
    this.idleTimer = null;
    this.handle = createStage(container, this.layout.format, { background: '#000' });
    this.stage = this.handle.stage;
    this.onInteraction = () => this.resetIdle();
    for (const ev of ['pointerdown', 'keydown', 'wheel']) container.addEventListener(ev, this.onInteraction, { passive: true, capture: true });
  }

  get ctx() {
    return {
      asset: (ref) => this.options.asset(ref),
      poster: (ref) => this.options.poster?.(ref) ?? null,
      onAction: (action) => this.run(action),
    };
  }

  start() {
    this.showPage(this.layout.pages[0].id, false);
  }

  /** Neues Layout (z. B. neue Revision). Läuft gerade ein Video, wird danach umgeschaltet. */
  replace(layout, options = {}) {
    if (this.video) {
      this.pending = { layout, options };
      return;
    }
    this.apply(layout, options);
  }

  apply(layout, options) {
    Object.assign(this.options, options);
    const formatChanged = layout.format.width !== this.layout.format.width || layout.format.height !== this.layout.format.height;
    this.layout = layout;
    if (formatChanged) {
      this.handle.destroy();
      this.handle = createStage(this.container, layout.format, { background: '#000' });
      this.stage = this.handle.stage;
    }
    this.history = [];
    this.showPage(layout.pages[0].id, false);
  }

  run(action) {
    if (!action) return;
    if (action.type === 'openVideo') this.playVideo(action.video, action.title);
    else if (action.type === 'openPage') this.showPage(action.page, true);
    else if (action.type === 'back') this.back();
  }

  showPage(id, push) {
    const page = this.layout.pages.find((p) => p.id === id) ?? this.layout.pages[0];
    if (push && this.pageId && this.pageId !== page.id) this.history.push(this.pageId);
    this.stopVideo();
    this.pageId = page.id;
    renderPage(this.stage, page, this.ctx);
    this.resetIdle();
    this.options.onEvent?.('page', { id: page.id });
  }

  back() {
    if (this.video) {
      this.closeVideo();
      return;
    }
    const prev = this.history.pop();
    this.showPage(prev ?? this.layout.pages[0].id, false);
  }

  playVideo(ref, title) {
    const src = this.options.asset(ref);
    if (!src) {
      this.options.onEvent?.('error', { message: `Video ${ref} nicht verfügbar` });
      return;
    }
    this.clearIdle();
    this.video = renderVideoPage(this.stage, this.layout, {
      src,
      title,
      muted: this.options.muted,
      onBack: () => this.closeVideo(),
      onEnded: () => this.closeVideo(),
      onError: (err) => {
        this.options.onEvent?.('error', { message: `Video ${ref} kann nicht abgespielt werden`, code: err?.code });
        this.closeVideo();
      },
    });
    this.video.play?.().catch(() => {
      // Autoplay mit Ton kann ohne vorherige Bedienung blockiert sein: dann stumm starten.
      if (this.video) {
        this.video.muted = true;
        this.video.play().catch(() => {});
      }
    });
    this.options.onEvent?.('video', { ref });
  }

  /** Video beenden und zur Seite zurück, von der es geöffnet wurde. */
  closeVideo() {
    this.stopVideo();
    if (this.pending) {
      const { layout, options } = this.pending;
      this.pending = null;
      this.apply(layout, options);
      return;
    }
    this.showPage(this.pageId ?? this.layout.pages[0].id, false);
  }

  stopVideo() {
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
      this.video = null;
    }
  }

  resetIdle() {
    this.clearIdle();
    const seconds = this.layout.idleTimeoutSeconds ?? 120;
    if (!seconds || this.video) return;
    this.idleTimer = setTimeout(() => {
      if (this.video) return;
      const home = this.layout.pages[0].id;
      if (this.pageId !== home || this.history.length) {
        this.history = [];
        this.showPage(home, false);
        this.options.onEvent?.('idle');
      }
    }, seconds * 1000);
  }

  clearIdle() {
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  destroy() {
    this.clearIdle();
    this.stopVideo();
    for (const ev of ['pointerdown', 'keydown', 'wheel']) this.container.removeEventListener(ev, this.onInteraction, { capture: true });
    this.handle.destroy();
  }
}
