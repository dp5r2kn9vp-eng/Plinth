// Plinth Layout-Renderer – gemeinsam für Studio (Editor, Vorschau) und Player.
// Zeichnet Layout-Seiten als HTML in Bezugseinheiten (1920x1080 bzw. 1080x1920)
// und skaliert die Bühne per CSS-Transform auf den verfügbaren Platz.
// Alle Inhalte werden per textContent/Properties gesetzt, nie als HTML.

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Skalierung, damit eine w×h-Fläche vollständig in den Container passt. */
export function fitScale(containerW, containerH, w, h) {
  return Math.min(containerW / w, containerH / h);
}

/**
 * Erzeugt eine Bühne in Bezugsgröße im Container und hält sie passend skaliert.
 * @returns {{stage: HTMLElement, scale: () => number, destroy: () => void, fit: () => void}}
 */
export function createStage(container, format, { background = '#000' } = {}) {
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  container.style.overflow = 'hidden';
  if (!container.style.background) container.style.background = background;

  const stage = document.createElement('div');
  stage.className = 'plinth-stage';
  Object.assign(stage.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    width: `${format.width}px`,
    height: `${format.height}px`,
    transformOrigin: '0 0',
    overflow: 'hidden',
  });
  container.appendChild(stage);

  let current = 1;
  const fit = () => {
    const rect = container.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    current = fitScale(rect.width, rect.height, format.width, format.height);
    const dx = (rect.width - format.width * current) / 2;
    const dy = (rect.height - format.height * current) / 2;
    stage.style.transform = `translate(${dx}px, ${dy}px) scale(${current})`;
  };
  const ro = new ResizeObserver(fit);
  ro.observe(container);
  fit();

  return {
    stage,
    scale: () => current,
    fit,
    destroy() {
      ro.disconnect();
      stage.remove();
    },
  };
}

function applyBackground(el, bg, ctx) {
  el.style.backgroundColor = bg?.color ?? '#000000';
  el.style.backgroundImage = '';
  const url = bg?.image ? ctx.asset(bg.image) : null;
  if (url) {
    el.style.backgroundImage = `url(${JSON.stringify(url)})`;
    el.style.backgroundSize = bg.fit === 'contain' ? 'contain' : 'cover';
    el.style.backgroundPosition = 'center';
    el.style.backgroundRepeat = 'no-repeat';
  }
}

function applyTextStyle(el, style = {}) {
  el.style.fontFamily = style.fontFamily ? `${quoteFont(style.fontFamily)}, system-ui, sans-serif` : 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  el.style.fontSize = `${style.fontSize ?? 48}px`;
  el.style.fontWeight = String(style.fontWeight ?? 400);
  el.style.fontStyle = style.italic ? 'italic' : 'normal';
  el.style.color = style.color ?? '#ffffff';
  el.style.lineHeight = String(style.lineHeight ?? 1.2);
  el.style.textAlign = style.align ?? 'left';
  el.style.justifyContent = { left: 'flex-start', center: 'center', right: 'flex-end' }[style.align ?? 'left'];
  el.style.alignItems = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[style.verticalAlign ?? 'top'];
  if (style.background) el.style.backgroundColor = style.background;
}

function quoteFont(name) {
  return `"${String(name).replace(/["\\]/g, '')}"`;
}

function playIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('aria-hidden', 'true');
  Object.assign(svg.style, { position: 'absolute', left: '50%', top: '50%', width: '18%', maxWidth: '160px', minWidth: '48px', transform: 'translate(-50%, -50%)', filter: 'drop-shadow(0 4px 12px rgba(0,0,0,.45))', pointerEvents: 'none' });
  const c = document.createElementNS(SVG_NS, 'circle');
  c.setAttribute('cx', '50'); c.setAttribute('cy', '50'); c.setAttribute('r', '48');
  c.setAttribute('fill', 'rgba(0,0,0,.45)'); c.setAttribute('stroke', '#fff'); c.setAttribute('stroke-width', '3');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', 'M40 30 L72 50 L40 70 Z'); p.setAttribute('fill', '#fff');
  svg.append(c, p);
  return svg;
}

/** Ein Element als DOM-Knoten. */
export function renderElement(el, ctx) {
  const node = document.createElement('div');
  node.className = `plinth-el plinth-${el.type}`;
  node.dataset.id = el.id;
  Object.assign(node.style, {
    position: 'absolute',
    left: `${el.x}px`,
    top: `${el.y}px`,
    width: `${el.w}px`,
    height: `${el.h}px`,
    opacity: String(el.opacity ?? 1),
    borderRadius: `${el.radius ?? 0}px`,
    transform: el.rotation ? `rotate(${el.rotation}deg)` : '',
    overflow: 'hidden',
    boxSizing: 'border-box',
  });

  switch (el.type) {
    case 'text': {
      node.style.display = 'flex';
      node.style.whiteSpace = 'pre-wrap';
      node.style.overflowWrap = 'break-word';
      applyTextStyle(node, el.style);
      const span = document.createElement('span');
      span.textContent = el.text;
      span.style.width = '100%';
      node.appendChild(span);
      break;
    }
    case 'image': {
      const url = ctx.asset(el.image);
      if (url) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        img.draggable = false;
        Object.assign(img.style, { width: '100%', height: '100%', objectFit: el.fit === 'cover' ? 'cover' : 'contain', display: 'block' });
        node.appendChild(img);
      } else {
        placeholder(node, 'Bild');
      }
      break;
    }
    case 'thumbnail': {
      node.style.background = '#111';
      const url = el.poster ? ctx.asset(el.poster) : ctx.poster?.(el.video);
      if (url) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        img.draggable = false;
        Object.assign(img.style, { width: '100%', height: '100%', objectFit: 'cover', display: 'block' });
        node.appendChild(img);
      } else {
        placeholder(node, 'Video');
      }
      if (el.showPlayIcon !== false) node.appendChild(playIcon());
      if (el.showTitle && el.title) {
        const cap = document.createElement('div');
        cap.textContent = el.title;
        Object.assign(cap.style, { position: 'absolute', left: '0', right: '0', bottom: '0', padding: '0.4em 0.6em', background: 'linear-gradient(transparent, rgba(0,0,0,.75))', display: 'flex' });
        applyTextStyle(cap, { fontSize: 36, fontWeight: 600, ...el.style });
        node.appendChild(cap);
      }
      break;
    }
    case 'button': {
      node.style.display = 'flex';
      node.style.padding = '0 0.5em';
      applyTextStyle(node, { align: 'center', verticalAlign: 'middle', fontWeight: 600, background: '#5ee0c1', color: '#06231c', ...el.style });
      const span = document.createElement('span');
      span.textContent = el.label;
      node.appendChild(span);
      break;
    }
    case 'shape':
      node.style.backgroundColor = el.fill;
      break;
    default:
      placeholder(node, el.type);
  }

  const action = actionOf(el);
  if (action && ctx.onAction) {
    node.style.cursor = 'pointer';
    node.setAttribute('role', 'button');
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      ctx.onAction(action, el);
    });
  }
  return node;
}

/** Aktion eines Elements; Thumbnails öffnen ohne eigene Aktion ihr Video. */
export function actionOf(el) {
  if (el.action) return el.action;
  if (el.type === 'thumbnail') return { type: 'openVideo', video: el.video, title: el.title };
  return null;
}

function placeholder(node, label) {
  Object.assign(node.style, { display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'repeating-linear-gradient(45deg,#2a313c,#2a313c 20px,#232a33 20px,#232a33 40px)', color: '#8b95a5', fontFamily: 'system-ui, sans-serif', fontSize: '32px' });
  const s = document.createElement('span');
  s.textContent = label;
  node.appendChild(s);
}

/** Zeichnet eine Seite in die Bühne (ersetzt den bisherigen Inhalt). */
export function renderPage(stage, page, ctx) {
  stage.replaceChildren();
  applyBackground(stage, page.background, ctx);
  for (const el of page.elements) stage.appendChild(renderElement(el, ctx));
}

/**
 * Videoseite: Kopfzeile mit Zurück-Button, darunter das Video.
 * @returns {HTMLVideoElement}
 */
export function renderVideoPage(stage, layout, { src, title, onBack, onEnded, onError, muted = false }) {
  const vp = layout.videoPage;
  const head = vp.header ?? { height: 0, backLabel: 'Zurück' };
  stage.replaceChildren();
  stage.style.backgroundImage = '';
  stage.style.backgroundColor = vp.background ?? '#000000';

  const h = head.height ?? 0;
  const color = head.color ?? '#ffffff';
  if (h > 0) {
    const bar = document.createElement('div');
    bar.className = 'plinth-video-header';
    Object.assign(bar.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: `${h}px`, background: head.background ?? '#151a22', color, display: 'flex', alignItems: 'center', gap: '24px', padding: '0 32px', boxSizing: 'border-box', fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', fontSize: `${head.fontSize ?? 40}px`, zIndex: '2' });
    bar.appendChild(backButton(head.backLabel, color, h, onBack));
    if (head.showTitle !== false && title) {
      const t = document.createElement('div');
      t.textContent = title;
      Object.assign(t.style, { fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
      bar.appendChild(t);
    }
    stage.appendChild(bar);
  } else {
    // Ohne Kopfzeile: schwebender Zurück-Button, damit man nie festhängt.
    const btn = backButton(head.backLabel || 'Zurück', '#ffffff', 110, onBack);
    Object.assign(btn.style, { position: 'absolute', left: '24px', top: '24px', zIndex: '2', background: 'rgba(0,0,0,.55)', borderRadius: '999px', padding: '12px 28px', fontSize: '36px' });
    stage.appendChild(btn);
  }

  const video = document.createElement('video');
  video.className = 'plinth-video';
  video.src = src;
  video.autoplay = true;
  video.muted = muted;
  video.playsInline = true;
  video.controls = false;
  Object.assign(video.style, { position: 'absolute', left: '0', top: `${h}px`, width: '100%', height: `calc(100% - ${h}px)`, objectFit: vp.fit === 'cover' ? 'cover' : 'contain', background: vp.background ?? '#000' });
  video.addEventListener('ended', () => onEnded?.());
  video.addEventListener('error', () => onError?.(video.error));
  stage.appendChild(video);
  return video;
}

function backButton(label, color, height, onBack) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'plinth-back';
  Object.assign(btn.style, { all: 'unset', cursor: 'pointer', color, display: 'flex', alignItems: 'center', gap: '12px', fontWeight: '600', height: `${Math.max(60, height * 0.8)}px`, fontFamily: 'inherit', fontSize: 'inherit' });
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  Object.assign(svg.style, { width: '1.1em', height: '1.1em' });
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', 'M15 4 L7 12 L15 20');
  p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '2.5'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(p);
  const span = document.createElement('span');
  span.textContent = label || 'Zurück';
  btn.append(svg, span);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onBack?.();
  });
  return btn;
}
