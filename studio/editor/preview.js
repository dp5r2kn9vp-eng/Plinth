// Vorschau: spielt den aktuellen Entwurf mit derselben Laufzeit wie der Player ab.

import { PlinthRuntime } from '../../shared/renderer/runtime.js';
import { h } from '../lib/dom.js';

export function openPreview(layout, assets) {
  const screen = h('div.preview-screen');
  const close = () => {
    runtime.destroy();
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  const overlay = h('div.preview', { role: 'dialog', 'aria-label': 'Vorschau' },
    h('div.preview-bar', {},
      h('strong', {}, 'Vorschau'),
      h('span.muted.small', {}, 'Klickbar wie auf dem Bildschirm · Esc schließt'),
      h('span.spacer'),
      h('button.btn.sm', { type: 'button', onclick: () => runtime.start() }, 'Zur Startseite'),
      h('button.btn.sm.primary', { type: 'button', onclick: close }, 'Schließen')),
    screen);
  document.body.appendChild(overlay);
  document.addEventListener('keydown', onKey);

  const runtime = new PlinthRuntime(screen, {
    layout: structuredClone(layout),
    asset: (ref) => assets.url(ref),
    poster: (ref) => assets.posterUrl(ref),
    onEvent: (type, d) => {
      if (type === 'error') screen.dataset.error = d.message;
    },
  });
  runtime.start();
  return { close, runtime };
}
