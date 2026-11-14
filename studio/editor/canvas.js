// Arbeitsfläche: zeigt die Seite mit dem gemeinsamen Renderer und legt Auswahl,
// Anfasser und Hilfslinien darüber. Verschieben/Größe ändern per Pointer-Events,
// Einrasten an Raster, Bühnenrändern/-mitte und anderen Elementen.

import { createStage, renderPage } from '../../shared/renderer/renderer.js';
import { h } from '../lib/dom.js';

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const SNAP_PX = 8; // Bildschirm-Pixel

export class Canvas {
  constructor(container, store, assets) {
    this.container = container;
    this.store = store;
    this.assets = assets;
    this.grid = 20;
    this.gridOn = false;
    this.mount();
    store.addEventListener('change', () => this.render());
    store.addEventListener('page', () => this.render());
    store.addEventListener('select', () => this.drawSelection());
  }

  mount() {
    this.handle?.destroy();
    this.format = { ...this.store.layout.format };
    this.handle = createStage(this.container, this.format, { background: 'transparent' });
    this.stage = this.handle.stage;
    this.stage.classList.add('editor-stage');
    this.stage.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    new ResizeObserver(() => this.drawSelection()).observe(this.container);
    this.render();
  }

  get scale() {
    return this.handle.scale();
  }

  render() {
    const f = this.store.layout.format;
    if (f.width !== this.format.width || f.height !== this.format.height) return this.mount();
    const page = this.store.page;
    if (!page) return;
    renderPage(this.stage, page, { asset: (r) => this.assets.url(r), poster: (r) => this.assets.posterUrl(r) });
    this.overlay = h('div.overlay');
    this.stage.appendChild(this.overlay);
    if (this.gridOn) this.stage.classList.add('show-grid');
    else this.stage.classList.remove('show-grid');
    this.stage.style.setProperty('--grid', `${this.grid}px`);
    this.drawSelection();
  }

  setGrid(on, size = this.grid) {
    this.gridOn = on;
    this.grid = size;
    this.render();
  }

  elNode(id) {
    return this.stage.querySelector(`.plinth-el[data-id="${CSS.escape(id)}"]`);
  }

  drawSelection(box = null) {
    if (!this.overlay) return;
    this.overlay.replaceChildren();
    const el = this.store.selected;
    if (!el) return;
    const b = box ?? el;
    const inv = 1 / this.scale;
    const sel = h('div.selection', { style: { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px`, borderWidth: `${2 * inv}px` } });
    for (const dir of HANDLES) {
      sel.appendChild(h(`div.handle.h-${dir}`, { dataset: { dir }, style: { width: `${12 * inv}px`, height: `${12 * inv}px`, margin: `${-6 * inv}px`, borderWidth: `${2 * inv}px` } }));
    }
    const label = h('div.size-label', { style: { fontSize: `${12 * inv}px`, top: `${-22 * inv}px` } }, `${Math.round(b.w)} × ${Math.round(b.h)}`);
    sel.appendChild(label);
    this.overlay.appendChild(sel);
  }

  drawGuides(lines) {
    this.overlay.querySelectorAll('.guide').forEach((g) => g.remove());
    const inv = 1 / this.scale;
    for (const l of lines) {
      const style = l.axis === 'x'
        ? { left: `${l.pos}px`, top: '0', width: `${inv}px`, height: '100%' }
        : { top: `${l.pos}px`, left: '0', height: `${inv}px`, width: '100%' };
      this.overlay.appendChild(h('div.guide', { style }));
    }
  }

  /** Bühnenkoordinaten eines Pointer-Events */
  point(e) {
    const r = this.stage.getBoundingClientRect();
    return { x: (e.clientX - r.left) / this.scale, y: (e.clientY - r.top) / this.scale };
  }

  onPointerDown(e) {
    if (e.button !== 0) return;
    const handle = e.target.closest('.handle');
    const node = e.target.closest('.plinth-el');
    if (!handle && !node) {
      this.store.select(null);
      return;
    }
    const id = handle ? this.store.selection : node.dataset.id;
    this.store.select(id);
    const el = this.store.selected;
    if (!el) return;
    e.preventDefault();
    this.stage.setPointerCapture(e.pointerId);

    const start = this.point(e);
    const orig = { x: el.x, y: el.y, w: el.w, h: el.h };
    const dir = handle?.dataset.dir ?? null;
    let box = { ...orig };
    let moved = false;
    const elNode = this.elNode(id);

    const move = (ev) => {
      const p = this.point(ev);
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      if (!moved && Math.hypot(dx * this.scale, dy * this.scale) < 3) return;
      moved = true;
      const snapOff = ev.altKey; // Alt hält das Einrasten aus
      const res = dir ? this.resize(orig, dir, dx, dy, ev.shiftKey, snapOff) : this.move(orig, dx, dy, snapOff);
      box = res.box;
      Object.assign(elNode.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
      this.drawSelection(box);
      this.drawGuides(res.guides);
    };
    const up = () => {
      this.stage.removeEventListener('pointermove', move);
      this.stage.removeEventListener('pointerup', up);
      this.stage.removeEventListener('pointercancel', up);
      if (!moved) return;
      const r = (v) => Math.round(v * 10) / 10;
      this.store.update((layout) => {
        const target = layout.pages.find((pg) => pg.id === this.store.pageId).elements.find((x) => x.id === id);
        Object.assign(target, { x: r(box.x), y: r(box.y), w: r(box.w), h: r(box.h) });
      });
    };
    this.stage.addEventListener('pointermove', move);
    this.stage.addEventListener('pointerup', up);
    this.stage.addEventListener('pointercancel', up);
  }

  /** Ziellinien zum Einrasten (x: senkrecht, y: waagerecht) */
  targets() {
    const { width: W, height: H } = this.store.layout.format;
    const xs = [0, W / 2, W];
    const ys = [0, H / 2, H];
    for (const o of this.store.page.elements) {
      if (o.id === this.store.selection) continue;
      xs.push(o.x, o.x + o.w / 2, o.x + o.w);
      ys.push(o.y, o.y + o.h / 2, o.y + o.h);
    }
    return { xs, ys };
  }

  snapValue(candidates, targets) {
    const tol = SNAP_PX / this.scale;
    let best = null;
    for (const c of candidates) {
      for (const t of targets) {
        const d = t - c.value;
        if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, pos: t };
      }
    }
    return best;
  }

  roundGrid(v) {
    return this.gridOn ? Math.round(v / this.grid) * this.grid : v;
  }

  move(o, dx, dy, snapOff) {
    let x = this.roundGrid(o.x + dx);
    let y = this.roundGrid(o.y + dy);
    const guides = [];
    if (!snapOff) {
      const t = this.targets();
      const sx = this.snapValue([{ value: x }, { value: x + o.w / 2 }, { value: x + o.w }], t.xs);
      const sy = this.snapValue([{ value: y }, { value: y + o.h / 2 }, { value: y + o.h }], t.ys);
      if (sx) {
        x += sx.delta;
        guides.push({ axis: 'x', pos: sx.pos });
      }
      if (sy) {
        y += sy.delta;
        guides.push({ axis: 'y', pos: sy.pos });
      }
    }
    return { box: { x, y, w: o.w, h: o.h }, guides };
  }

  resize(o, dir, dx, dy, keepRatio, snapOff) {
    let { x, y, w, h: hh } = o;
    const t = snapOff ? null : this.targets();
    const guides = [];
    const snap = (value, axis) => {
      let v = this.roundGrid(value);
      if (t) {
        const s = this.snapValue([{ value: v }], axis === 'x' ? t.xs : t.ys);
        if (s) {
          v += s.delta;
          guides.push({ axis, pos: s.pos });
        }
      }
      return v;
    };
    if (dir.includes('e')) w = snap(o.x + o.w + dx, 'x') - x;
    if (dir.includes('s')) hh = snap(o.y + o.h + dy, 'y') - y;
    if (dir.includes('w')) {
      const nx = snap(o.x + dx, 'x');
      w = o.x + o.w - nx;
      x = nx;
    }
    if (dir.includes('n')) {
      const ny = snap(o.y + dy, 'y');
      hh = o.y + o.h - ny;
      y = ny;
    }
    w = Math.max(10, w);
    hh = Math.max(10, hh);
    if (keepRatio && o.w && o.h) {
      const ratio = o.w / o.h;
      if (dir === 'n' || dir === 's') w = hh * ratio;
      else hh = w / ratio;
      if (dir.includes('n')) y = o.y + o.h - hh;
      if (dir.includes('w')) x = o.x + o.w - w;
    }
    return { box: { x, y, w, h: hh }, guides };
  }
}
