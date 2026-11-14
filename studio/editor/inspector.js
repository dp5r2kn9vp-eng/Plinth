// Eigenschaften-Panel: Formular für das ausgewählte Element, die Seite oder die Videoseite.

import { h } from '../lib/dom.js';
import { VIDEO_PAGE } from './store.js';

const FONTS = ['', 'Segoe UI', 'Arial', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Courier New'];
const TYPE_NAMES = { text: 'Text', image: 'Bild', thumbnail: 'Video-Thumbnail', button: 'Button', shape: 'Farbfläche' };

export class Inspector {
  constructor(container, store, assets, { onSelectFormat } = {}) {
    this.container = container;
    this.store = store;
    this.assets = assets;
    this.onSelectFormat = onSelectFormat;
    for (const ev of ['select', 'page']) store.addEventListener(ev, () => this.render());
    // Bei Rückgängig/Wiederholen Formular neu aufbauen; beim Tippen nicht (Fokus bleibt)
    store.addEventListener('change', (e) => {
      if (e.detail.source !== 'edit' || !this.container.contains(document.activeElement)) this.render();
    });
    assets.addEventListener('change', () => this.render());
    this.render();
  }

  render() {
    const s = this.store;
    let content;
    if (s.pageId === VIDEO_PAGE) content = this.videoPageForm();
    else if (s.selected) content = this.elementForm(s.selected);
    else content = this.pageForm(s.page);
    this.container.replaceChildren(content);
  }

  /** Ändert das ausgewählte Element. */
  set(field, value) {
    const id = this.store.selection;
    this.store.update((l) => {
      const el = l.pages.find((p) => p.id === this.store.pageId).elements.find((e) => e.id === id);
      setPath(el, field, value);
    }, { merge: `${id}:${field}` });
  }

  setPage(field, value) {
    const pid = this.store.pageId;
    this.store.update((l) => setPath(l.pages.find((p) => p.id === pid), field, value), { merge: `page:${pid}:${field}` });
  }

  setLayout(field, value) {
    this.store.update((l) => setPath(l, field, value), { merge: `layout:${field}` });
  }

  // ---------- Element ----------

  elementForm(el) {
    const set = (f) => (v) => this.set(f, v);
    const rows = [
      h('div.insp-head', {}, h('strong', {}, TYPE_NAMES[el.type] ?? el.type), h('span.muted', {}, el.id)),
      section('Position & Größe',
        grid2(
          num('X', el.x, set('x')), num('Y', el.y, set('y')),
          num('Breite', el.w, set('w'), { min: 10 }), num('Höhe', el.h, set('h'), { min: 10 }),
        ),
        grid2(
          range('Deckkraft', el.opacity ?? 1, set('opacity'), 0, 1, 0.05),
          num('Ecken', el.radius ?? 0, set('radius'), { min: 0 }),
        ),
        h('div.btn-row', {},
          h('button.btn.sm', { type: 'button', title: 'Ganz nach hinten', onclick: () => this.layer('bottom') }, '⇊'),
          h('button.btn.sm', { type: 'button', title: 'Eine Ebene nach hinten', onclick: () => this.layer('down') }, '↓'),
          h('button.btn.sm', { type: 'button', title: 'Eine Ebene nach vorne', onclick: () => this.layer('up') }, '↑'),
          h('button.btn.sm', { type: 'button', title: 'Ganz nach vorne', onclick: () => this.layer('top') }, '⇈'),
          h('span.spacer'),
          h('button.btn.sm', { type: 'button', title: 'Duplizieren (Strg+D)', onclick: () => this.duplicate() }, 'Duplizieren'),
          h('button.btn.sm.danger', { type: 'button', title: 'Löschen (Entf)', onclick: () => this.remove() }, 'Löschen'),
        )),
    ];

    if (el.type === 'text') {
      rows.push(section('Text',
        field('Inhalt', h('textarea', { rows: 3, value: el.text, oninput: (e) => this.set('text', e.target.value), 'data-focus': 'text' })),
        this.textStyle(el.style ?? {}, (f, v) => this.set(`style.${f}`, v), { background: true })));
    }
    if (el.type === 'image') {
      rows.push(section('Bild',
        this.assetSelect('Datei', el.image, 'bild', (v) => v && this.set('image', v), false),
        select('Darstellung', el.fit ?? 'contain', [['contain', 'Ganz zeigen'], ['cover', 'Ausfüllen (zuschneiden)']], set('fit'))),
      section('Aktion beim Antippen', this.actionForm(el.action, true)));
    }
    if (el.type === 'thumbnail') {
      rows.push(section('Video',
        this.assetSelect('Video', el.video, 'video', (v) => v && this.set('video', v), false),
        this.assetSelect('Vorschaubild', el.poster ?? '', 'bild', (v) => this.set('poster', v || undefined), true, 'Automatisch (Standbild)'),
        field('Titel', h('input', { type: 'text', value: el.title ?? '', maxLength: 200, oninput: (e) => this.set('title', e.target.value || undefined) })),
        check('Titel im Bild zeigen', el.showTitle ?? false, set('showTitle')),
        check('Play-Symbol zeigen', el.showPlayIcon ?? true, set('showPlayIcon'))),
      el.showTitle ? section('Titelschrift', this.textStyle(el.style ?? {}, (f, v) => this.set(`style.${f}`, v), { compact: true })) : null);
    }
    if (el.type === 'button') {
      rows.push(section('Button',
        field('Beschriftung', h('input', { type: 'text', value: el.label, maxLength: 200, oninput: (e) => this.set('label', e.target.value) })),
        this.textStyle(el.style ?? {}, (f, v) => this.set(`style.${f}`, v), { background: true, compact: true })),
      section('Aktion beim Antippen', this.actionForm(el.action, false)));
    }
    if (el.type === 'shape') {
      rows.push(section('Fläche', color('Farbe', el.fill, set('fill'))));
    }
    return h('div.insp', {}, rows);
  }

  textStyle(st, set, { background = false, compact = false } = {}) {
    return h('div', {},
      compact ? null : select('Schrift', st.fontFamily ?? '', FONTS.map((f) => [f, f || 'Standard (System)']), (v) => set('fontFamily', v || undefined)),
      grid2(
        num('Größe', st.fontSize ?? 48, (v) => set('fontSize', v), { min: 4 }),
        select('Stärke', String(st.fontWeight ?? 400), [['400', 'Normal'], ['500', 'Mittel'], ['600', 'Halbfett'], ['700', 'Fett'], ['800', 'Extrafett']], (v) => set('fontWeight', Number(v))),
      ),
      grid2(
        color('Farbe', st.color ?? '#ffffff', (v) => set('color', v)),
        compact ? null : check('Kursiv', st.italic ?? false, (v) => set('italic', v || undefined)),
      ),
      compact ? null : grid2(
        select('Ausrichtung', st.align ?? 'left', [['left', 'Links'], ['center', 'Mitte'], ['right', 'Rechts']], (v) => set('align', v)),
        select('Vertikal', st.verticalAlign ?? 'top', [['top', 'Oben'], ['middle', 'Mitte'], ['bottom', 'Unten']], (v) => set('verticalAlign', v)),
      ),
      compact ? null : num('Zeilenhöhe', st.lineHeight ?? 1.2, (v) => set('lineHeight', v), { min: 0.5, step: 0.05 }),
      background ? optionalColor('Hintergrund', st.background, (v) => set('background', v)) : null,
    );
  }

  actionForm(action, optional) {
    const type = action?.type ?? '';
    const pages = this.store.layout.pages;
    const opts = [...(optional ? [['', 'Keine']] : []), ['openVideo', 'Video abspielen'], ['openPage', 'Seite öffnen'], ['back', 'Zurück']];
    const change = (t) => {
      if (!t) return this.set('action', undefined);
      if (t === 'back') return this.set('action', { type: 'back' });
      if (t === 'openPage') {
        const target = pages.find((p) => p.id !== this.store.pageId) ?? pages[0];
        return this.set('action', { type: 'openPage', page: target.id });
      }
      const v = this.assets.list('video')[0];
      if (!v) {
        alert('Zuerst ein Video in die Medienbibliothek hochladen.');
        return this.render();
      }
      this.set('action', { type: 'openVideo', video: v.ref, title: v.name });
    };
    return h('div', {},
      select('Aktion', type, opts, change),
      type === 'openVideo' ? [
        this.assetSelect('Video', action.video, 'video', (v) => v && this.set('action.video', v), false),
        field('Titel in der Kopfzeile', h('input', { type: 'text', value: action.title ?? '', oninput: (e) => this.set('action.title', e.target.value || undefined) })),
      ] : null,
      type === 'openPage' ? select('Seite', action.page, pages.map((p) => [p.id, p.name || p.id]), (v) => this.set('action.page', v)) : null,
    );
  }

  assetSelect(label, value, typ, onChange, allowNone, noneLabel = '– keine –') {
    const items = this.assets.list(typ);
    const opts = [...(allowNone ? [['', noneLabel]] : []), ...items.map((d) => [d.ref, d.name])];
    if (value && !items.some((d) => d.ref === value)) opts.push([value, `${value} (nicht in der Bibliothek)`]);
    if (!opts.length) return field(label, h('p.muted.small', {}, typ === 'video' ? 'Noch keine Videos hochgeladen.' : 'Noch keine Bilder hochgeladen.'));
    const preview = value ? (typ === 'video' ? this.assets.posterUrl(value) : this.assets.url(value)) : null;
    return h('div', {},
      select(label, value ?? '', opts, onChange),
      preview ? h('img.asset-preview', { src: preview, alt: '' }) : null);
  }

  layer(where) {
    const id = this.store.selection;
    this.store.update((l) => {
      const els = l.pages.find((p) => p.id === this.store.pageId).elements;
      const i = els.findIndex((e) => e.id === id);
      const [el] = els.splice(i, 1);
      const to = { top: els.length, bottom: 0, up: Math.min(els.length, i + 1), down: Math.max(0, i - 1) }[where];
      els.splice(to, 0, el);
    });
  }

  duplicate() {
    const el = this.store.selected;
    if (!el) return;
    const copy = { ...structuredClone(el), id: this.store.newId(el.type), x: el.x + 30, y: el.y + 30 };
    this.store.update((l) => l.pages.find((p) => p.id === this.store.pageId).elements.push(copy));
    this.store.select(copy.id);
  }

  remove() {
    const id = this.store.selection;
    if (!id) return;
    this.store.update((l) => {
      const page = l.pages.find((p) => p.id === this.store.pageId);
      page.elements = page.elements.filter((e) => e.id !== id);
    });
    this.store.select(null);
  }

  // ---------- Seite ----------

  pageForm(page) {
    const l = this.store.layout;
    const isHome = l.pages[0].id === page.id;
    const bg = page.background ?? {};
    return h('div.insp', {},
      h('div.insp-head', {}, h('strong', {}, isHome ? 'Startseite' : 'Seite'), h('span.muted', {}, page.id)),
      section('Seite',
        field('Name', h('input', { type: 'text', value: page.name ?? '', maxLength: 100, oninput: (e) => this.setPage('name', e.target.value || undefined) })),
        isHome ? null : h('button.btn.sm.danger', { type: 'button', onclick: () => this.removePage(page.id) }, 'Seite löschen')),
      section('Hintergrund',
        color('Farbe', bg.color ?? '#000000', (v) => this.setPage('background.color', v)),
        this.assetSelect('Bild', bg.image ?? '', 'bild', (v) => this.setPage('background.image', v || undefined), true),
        bg.image ? select('Darstellung', bg.fit ?? 'cover', [['cover', 'Ausfüllen'], ['contain', 'Ganz zeigen']], (v) => this.setPage('background.fit', v)) : null),
      section('Bildschirm',
        select('Ausrichtung', l.format.orientation, [['landscape', 'Quer (1920 × 1080)'], ['portrait', 'Hochkant (1080 × 1920)']], (v) => this.onSelectFormat?.(v)),
        num('Zurück zur Startseite nach (Sekunden ohne Bedienung, 0 = nie)', l.idleTimeoutSeconds ?? 120, (v) => this.setLayout('idleTimeoutSeconds', Math.max(0, Math.round(v))), { min: 0 })),
      h('p.muted.small', {}, 'Tipp: Element anklicken, um es zu bearbeiten. Pfeiltasten verschieben (mit Umschalt in 10er-Schritten), Alt beim Ziehen schaltet das Einrasten aus.'),
    );
  }

  removePage(id) {
    if (!confirm('Seite mit allen Elementen löschen?')) return;
    this.store.update((l) => {
      l.pages = l.pages.filter((p) => p.id !== id);
      for (const p of l.pages) {
        for (const e of p.elements) if (e.action?.type === 'openPage' && e.action.page === id) delete e.action;
      }
    });
    this.store.setPage(this.store.layout.pages[0].id);
  }

  // ---------- Videoseite ----------

  videoPageForm() {
    const vp = this.store.layout.videoPage;
    const hd = vp.header;
    const set = (f) => (v) => this.setLayout(`videoPage.${f}`, v);
    return h('div.insp', {},
      h('div.insp-head', {}, h('strong', {}, 'Videoseite'), h('span.muted', {}, 'gilt für alle Videos')),
      section('Kopfzeile',
        num('Höhe (0 = ausblenden, dann schwebender Zurück-Button)', hd.height, set('header.height'), { min: 0 }),
        field('Beschriftung Zurück-Button', h('input', { type: 'text', value: hd.backLabel, maxLength: 100, oninput: (e) => this.setLayout('videoPage.header.backLabel', e.target.value) })),
        grid2(color('Hintergrund', hd.background ?? '#151a22', set('header.background')), color('Schrift', hd.color ?? '#ffffff', set('header.color'))),
        grid2(num('Schriftgröße', hd.fontSize ?? 40, set('header.fontSize'), { min: 8 }), check('Videotitel zeigen', hd.showTitle ?? true, set('header.showTitle')))),
      section('Video',
        color('Hintergrund', vp.background ?? '#000000', set('background')),
        select('Darstellung', vp.fit ?? 'contain', [['contain', 'Ganz zeigen (Ränder)'], ['cover', 'Ausfüllen (zuschneiden)']], set('fit'))),
      h('p.muted.small', {}, 'Nach dem Ende des Videos geht es immer automatisch zurück zur Seite, von der es geöffnet wurde.'),
    );
  }
}

// ---------- Hilfen ----------

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  const last = keys.at(-1);
  if (value === undefined) delete o[last];
  else o[last] = value;
}

const section = (title, ...children) => h('section.insp-section', {}, h('h3', {}, title), ...children);
const grid2 = (...children) => h('div.grid2', {}, ...children);
const field = (label, input) => h('label.field', {}, h('span', {}, label), input);

function num(label, value, onChange, { min, step = 1 } = {}) {
  return field(label, h('input', {
    type: 'number', value: Math.round(value * 100) / 100, step, min,
    oninput: (e) => {
      const v = Number(e.target.value);
      if (e.target.value !== '' && Number.isFinite(v) && (min === undefined || v >= min)) onChange(v);
    },
  }));
}

function range(label, value, onChange, min, max, step) {
  return field(label, h('input', { type: 'range', min, max, step, value, oninput: (e) => onChange(Number(e.target.value)) }));
}

function color(label, value, onChange) {
  return field(label, h('input', { type: 'color', value: (value ?? '#000000').slice(0, 7), oninput: (e) => onChange(e.target.value) }));
}

function optionalColor(label, value, onChange) {
  const input = h('input', { type: 'color', value: (value ?? '#000000').slice(0, 7), disabled: !value, oninput: (e) => onChange(e.target.value) });
  return h('label.field', {}, h('span', {}, label),
    h('div.inline', {},
      h('input', { type: 'checkbox', checked: !!value, onchange: (e) => onChange(e.target.checked ? input.value : undefined) }),
      input));
}

function check(label, value, onChange) {
  return h('label.check', {}, h('input', { type: 'checkbox', checked: value, onchange: (e) => onChange(e.target.checked) }), label);
}

function select(label, value, options, onChange) {
  return field(label, h('select', { onchange: (e) => onChange(e.target.value) },
    options.map(([v, text]) => h('option', { value: v, selected: v === value }, text))));
}
