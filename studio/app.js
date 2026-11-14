// Plinth Studio – Einstieg. Lädt Benutzer und Projekte, baut den Editor und speichert automatisch.

import { get, post, put, ApiError } from './lib/api.js';
import { h, debounce, toast, dialog } from './lib/dom.js';
import { Store, VIDEO_PAGE } from './editor/store.js';
import { Canvas } from './editor/canvas.js';
import { Inspector } from './editor/inspector.js';
import { Assets } from './editor/assets.js';
import { Library } from './editor/library.js';
import { openPreview } from './editor/preview.js';
import { publish } from './editor/publish.js';
import { renderDevices } from './devices.js';
import { renderOfflineDevices } from './devices-offline.js';
import { mode } from './lib/mode.js';

const app = document.getElementById('app');
const state = { user: null, projekte: [], projekt: null, version: 0, store: null, save: 'saved', view: 'editor' };
const assets = new Assets();

async function boot() {
  try {
    const me = await get('/auth/me');
    state.user = me.user;
    mode.offline = me.modus === 'offline';
    document.body.classList.toggle('offline', mode.offline);
  } catch {
    return; // api() leitet bei 401 zur Anmeldung weiter
  }
  await Promise.all([loadProjects(), assets.load()]);
  if (!state.projekte.length) {
    await createProject(true);
    return;
  }
  const wanted = Number(new URLSearchParams(location.search).get('projekt')) || Number(localStorage.getItem('plinth-projekt'));
  await openProject(state.projekte.find((p) => p.id === wanted) ?? state.projekte[0]);
}

async function loadProjects() {
  state.projekte = (await get('/projekte')).projekte;
}

// ---------- Kopfzeile ----------

function header() {
  const saveText = { saved: 'Gespeichert', dirty: 'Ungespeicherte Änderungen', saving: 'Speichert …', error: 'Nicht gespeichert', conflict: 'Konflikt' }[state.save];
  return h('header.topbar', {},
    h('div.brand', {}, h('img', { src: 'logo.svg', alt: '', width: 26, height: 26 }), 'Plinth ', h('small', {}, 'Studio')),
    h('select.project-select', { 'aria-label': 'Projekt', onchange: async (e) => {
      if (e.target.value === '__new') {
        e.target.value = String(state.projekt.id);
        await createProject(false);
      } else {
        await flushSave();
        await openProject(state.projekte.find((p) => p.id === Number(e.target.value)));
      }
    } },
    state.projekte.map((p) => h('option', { value: p.id, selected: p.id === state.projekt?.id }, `${p.name}${p.ausrichtung === 'portrait' ? ' (hochkant)' : ''}`)),
    h('option', { value: '__new' }, '+ Neues Projekt …')),
    h('nav.tabs', {},
      h(`button${state.view === 'editor' ? '.on' : ''}`, { type: 'button', onclick: () => switchView('editor') }, 'Gestalten'),
      h(`button${state.view === 'geraete' ? '.on' : ''}`, { type: 'button', onclick: () => switchView('geraete') }, 'Geräte')),
    h('span.spacer'),
    state.view === 'editor' ? [
      h(`span.save-state.${state.save}`, { 'data-testid': 'save-state' }, saveText),
      h('button.btn.icon', { type: 'button', title: 'Rückgängig (Strg+Z)', disabled: !state.store?.undoStack.length, onclick: () => state.store.undo() }, '↶'),
      h('button.btn.icon', { type: 'button', title: 'Wiederholen (Strg+Umschalt+Z)', disabled: !state.store?.redoStack.length, onclick: () => state.store.redo() }, '↷'),
      h('button.btn', { type: 'button', onclick: () => openPreview(state.store.layout, assets) }, 'Vorschau'),
      h('button.btn.primary', { type: 'button', onclick: doPublish }, 'Veröffentlichen'),
    ] : null,
    h('div.user', {}, h('span.muted.small', {}, mode.offline ? `Offline · ${state.user.name}` : state.user.name),
      mode.offline ? null : h('button.btn.sm', { type: 'button', onclick: logout }, 'Abmelden')));
}

function refreshHeader() {
  const old = app.querySelector('header.topbar');
  if (old) old.replaceWith(header());
}

async function switchView(view) {
  await flushSave();
  state.view = view;
  if (view === 'editor') renderEditor();
  else {
    const main = h('main.page');
    app.replaceChildren(header(), main);
    (mode.offline ? renderOfflineDevices : renderDevices)(main).catch((e) => toast(e.message, 'error'));
  }
}

async function logout() {
  await flushSave();
  await post('/auth/logout').catch(() => {});
  location.href = '/studio/login.html';
}

// ---------- Projekte ----------

async function createProject(first) {
  const name = h('input', { name: 'name', required: true, maxLength: 190, value: first ? 'Hauptbildschirm' : '' });
  const orient = h('div.orient', {},
    h('label.check', {}, h('input', { type: 'radio', name: 'o', value: 'landscape', checked: true }), 'Quer (1920 × 1080) – Standard'),
    h('label.check', {}, h('input', { type: 'radio', name: 'o', value: 'portrait' }), 'Hochkant (1080 × 1920)'));
  const result = await dialog(first ? 'Erstes Projekt anlegen' : 'Neues Projekt', h('div', {},
    h('label.field', {}, h('span', {}, 'Name'), name),
    h('div.field', {}, h('span', {}, 'Format'), orient)), {
    ok: 'Anlegen',
    cancel: first ? null : 'Abbrechen',
    onOk: async (form) => {
      if (!name.value.trim()) return false;
      return (await post('/projekte', { name: name.value.trim(), ausrichtung: form.querySelector('input[name=o]:checked').value })).projekt;
    },
  });
  if (result) {
    await loadProjects();
    await openProject(state.projekte.find((p) => p.id === result.id));
  }
}

async function openProject(projekt) {
  const draft = await get(`/projekte/${projekt.id}/entwurf`);
  state.projekt = projekt;
  state.version = draft.version;
  state.save = 'saved';
  localStorage.setItem('plinth-projekt', String(projekt.id));
  history.replaceState(null, '', `?projekt=${projekt.id}`);
  state.store = new Store(draft.layout);
  state.store.addEventListener('change', (e) => {
    if (e.detail.source !== 'load') markDirty();
    refreshHeader();
    renderPagesBar();
  });
  state.store.addEventListener('page', renderPagesBar);
  if (state.view === 'editor') renderEditor();
  else switchView(state.view);
}

// ---------- Speichern ----------

let saving = null;
const autosave = debounce(() => save(), 1200);

function markDirty() {
  if (state.save === 'conflict') return;
  state.save = 'dirty';
  autosave();
}

async function save() {
  if (saving) {
    await saving;
    if (state.save !== 'dirty') return;
  }
  if (state.save === 'saved' || state.save === 'conflict') return;
  state.save = 'saving';
  refreshHeader();
  const sent = structuredClone(state.store.layout);
  saving = (async () => {
    try {
      const res = await put(`/projekte/${state.projekt.id}/entwurf`, { layout: sent, version: state.version });
      state.version = res.version;
      // Während des Speicherns weiter bearbeitet? Dann bleibt der Stand "dirty".
      state.save = JSON.stringify(sent) === JSON.stringify(state.store.layout) ? 'saved' : 'dirty';
      if (state.save === 'dirty') autosave();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'draft_conflict') {
        state.save = 'conflict';
        showConflict(e.details.version);
      } else {
        state.save = 'error';
        toast(e.code === 'invalid_layout' ? `Ungültig: ${(e.details.errors ?? [])[0] ?? e.message}` : `Speichern fehlgeschlagen: ${e.message}`, 'error');
        setTimeout(() => {
          if (state.save === 'error') {
            state.save = 'dirty';
            save();
          }
        }, 5000);
      }
    } finally {
      saving = null;
      refreshHeader();
    }
  })();
  await saving;
}

async function flushSave() {
  autosave.cancel();
  if (state.save === 'dirty' || state.save === 'error') await save();
  else if (saving) await saving;
  if (state.save === 'conflict') throw new Error('Der Entwurf wurde an anderer Stelle geändert – bitte Konflikt zuerst lösen.');
  if (state.save === 'error') throw new Error('Entwurf konnte nicht gespeichert werden.');
}

function showConflict(serverVersion) {
  dialog('Entwurf wurde an anderer Stelle geändert', h('div', {},
    h('p', {}, 'Jemand (oder ein anderer Tab) hat diesen Entwurf inzwischen gespeichert.'),
    h('p.muted.small', {}, '„Neu laden“ übernimmt den gespeicherten Stand. „Meine Version behalten“ überschreibt ihn mit deinen Änderungen.')), {
    ok: 'Meine Version behalten',
    cancel: 'Neu laden',
  }).then(async (keep) => {
    if (keep) {
      state.version = serverVersion;
      state.save = 'dirty';
      await save();
    } else {
      const draft = await get(`/projekte/${state.projekt.id}/entwurf`);
      state.version = draft.version;
      state.save = 'saved';
      state.store.replace(draft.layout);
    }
    refreshHeader();
  });
}

window.addEventListener('beforeunload', (e) => {
  if (['dirty', 'saving', 'error', 'conflict'].includes(state.save)) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ---------- Editor ----------

let canvas;

function renderEditor() {
  const library = h('aside.library');
  const canvasWrap = h('div.canvas-wrap', { tabIndex: 0, 'data-testid': 'canvas' });
  const inspector = h('aside.inspector');
  const toolbar = h('div.toolbar', {},
    h('span.muted.small', {}, 'Einfügen:'),
    h('button.btn.sm', { type: 'button', onclick: () => addElement('text') }, 'Text'),
    h('button.btn.sm', { type: 'button', onclick: () => addElement('image') }, 'Bild'),
    h('button.btn.sm', { type: 'button', onclick: () => addElement('thumbnail') }, 'Video'),
    h('button.btn.sm', { type: 'button', onclick: () => addElement('button') }, 'Button'),
    h('button.btn.sm', { type: 'button', onclick: () => addElement('shape') }, 'Fläche'),
    h('span.spacer'),
    h('label.check.small', {}, h('input', { type: 'checkbox', onchange: (e) => canvas.setGrid(e.target.checked) }), 'Raster'),
    h('select.small', { 'aria-label': 'Rastergröße', onchange: (e) => canvas.setGrid(canvas.gridOn, Number(e.target.value)) },
      [10, 20, 40, 60].map((n) => h('option', { value: n, selected: n === 20 }, `${n} px`))));

  app.replaceChildren(header(), h('main.editor', {},
    library,
    h('section.center', {}, h('div.pages-bar'), toolbar, h('div.canvas-area', {}, canvasWrap)),
    inspector));

  if (state.store.pageId === VIDEO_PAGE) state.store.pageId = state.store.layout.pages[0].id;
  canvas = new Canvas(canvasWrap, state.store, assets);
  new Inspector(inspector, state.store, assets, { onSelectFormat: changeOrientation });
  new Library(library, assets, { onInsert: insertAsset });
  renderPagesBar();
  canvasWrap.addEventListener('keydown', onKey);
  canvasWrap.addEventListener('pointerdown', () => canvasWrap.focus({ preventScroll: true }));
  canvasWrap.focus();
}

function renderPagesBar() {
  const bar = app.querySelector('.pages-bar');
  if (!bar) return;
  const s = state.store;
  bar.replaceChildren(
    ...s.layout.pages.map((p, i) => h(`button.page-tab${s.pageId === p.id ? '.on' : ''}`, { type: 'button', onclick: () => s.setPage(p.id) }, p.name || (i === 0 ? 'Startseite' : p.id))),
    h('button.page-tab.add', { type: 'button', title: 'Seite hinzufügen', onclick: addPage }, '+ Seite'),
    h('span.spacer'),
    h(`button.page-tab${s.pageId === VIDEO_PAGE ? '.on' : ''}`, { type: 'button', onclick: () => s.setPage(VIDEO_PAGE) }, 'Videoseite'));
  // Videoseite: Arbeitsfläche zeigt eine Beispiel-Darstellung
  const area = app.querySelector('.canvas-area');
  area?.classList.toggle('video-mode', s.pageId === VIDEO_PAGE);
  if (s.pageId === VIDEO_PAGE) renderVideoPagePreview(area);
  else area?.querySelector('.video-sample')?.remove();
}

function renderVideoPagePreview(area) {
  area.querySelector('.video-sample')?.remove();
  const box = h('div.video-sample');
  area.appendChild(box);
  import('../shared/renderer/renderer.js').then(({ createStage, renderVideoPage }) => {
    const { stage } = createStage(box, state.store.layout.format, { background: 'transparent' });
    const video = renderVideoPage(stage, state.store.layout, { src: '', title: 'Beispielvideo', onBack: () => {} });
    video.removeAttribute('src');
    video.style.background = 'repeating-linear-gradient(45deg,#1b2029,#1b2029 30px,#151a22 30px,#151a22 60px)';
  });
}

function addPage() {
  const s = state.store;
  const id = s.newId('seite');
  s.update((l) => l.pages.push({ id, name: `Seite ${l.pages.length + 1}`, background: { color: l.pages[0].background?.color ?? '#0e1116' }, elements: [
    { id: `${id}-zurueck`, type: 'button', x: 40, y: 40, w: 300, h: 110, radius: 55, label: 'Zurück', action: { type: 'back' } },
  ] }));
  s.setPage(id);
}

/** Mittig einfügen; liegt dort schon ein Element, versetzt (wie beim Duplizieren). */
function center(w, hgt) {
  const { width, height } = state.store.layout.format;
  let x = Math.round((width - w) / 2);
  let y = Math.round((height - hgt) / 2);
  const taken = (state.store.page?.elements ?? []).map((e) => `${e.x},${e.y}`);
  while (taken.includes(`${x},${y}`)) {
    x += 40;
    y += 40;
  }
  return { x, y, w, h: hgt };
}

function addElement(type, extra = {}) {
  const s = state.store;
  if (s.pageId === VIDEO_PAGE) s.setPage(s.layout.pages[0].id);
  let el;
  if (type === 'text') el = { type, ...center(900, 140), text: 'Neuer Text', style: { fontSize: 72, fontWeight: 700, color: '#ffffff' } };
  if (type === 'shape') el = { type, ...center(500, 300), fill: '#5ee0c1', radius: 0 };
  if (type === 'button') {
    const other = s.layout.pages.find((p) => p.id !== s.pageId);
    el = { type, ...center(420, 120), radius: 60, label: other ? other.name ?? 'Weiter' : 'Zurück', action: other ? { type: 'openPage', page: other.id } : { type: 'back' }, style: { fontSize: 44 } };
  }
  if (type === 'image' || type === 'thumbnail') {
    const d = extra.datei ?? assets.list(type === 'image' ? 'bild' : 'video').filter((x) => !assets.posterIds().has(x.id))[0];
    if (!d) {
      toast(type === 'image' ? 'Zuerst ein Bild in „Medien“ hochladen.' : 'Zuerst ein Video in „Medien“ hochladen.', 'error');
      return;
    }
    const ratio = d.breite && d.hoehe ? d.breite / d.hoehe : 16 / 9;
    const w = type === 'image' ? Math.min(800, d.breite ?? 800) : 800;
    el = type === 'image'
      ? { type, ...center(w, Math.round(w / ratio)), image: d.ref, fit: 'contain' }
      : { type, ...center(w, Math.round(w / (16 / 9))), video: d.ref, title: d.name.replace(/\.[^.]+$/, ''), radius: 16 };
  }
  el = { id: s.newId(type), ...el };
  s.update((l) => l.pages.find((p) => p.id === s.pageId).elements.push(el));
  s.select(el.id);
}

function insertAsset(d) {
  addElement(d.typ === 'video' ? 'thumbnail' : 'image', { datei: d });
}

async function changeOrientation(orientation) {
  const l = state.store.layout;
  if (l.format.orientation === orientation) return;
  const ok = await dialog('Ausrichtung ändern?', h('p', {}, 'Alle Elemente werden proportional verkleinert bzw. vergrößert und mittig angeordnet. Danach meist noch nachjustieren.'), { ok: 'Ändern' });
  if (!ok) {
    state.store.emit('select');
    return;
  }
  const [W, H] = orientation === 'portrait' ? [1080, 1920] : [1920, 1080];
  const k = Math.min(W / l.format.width, H / l.format.height);
  const dx = (W - l.format.width * k) / 2;
  const dy = (H - l.format.height * k) / 2;
  const r = (v) => Math.round(v * 10) / 10;
  state.store.update((layout) => {
    layout.format = { orientation, width: W, height: H };
    for (const p of layout.pages) {
      for (const e of p.elements) {
        Object.assign(e, { x: r(e.x * k + dx), y: r(e.y * k + dy), w: r(e.w * k), h: r(e.h * k) });
        if (e.style?.fontSize) e.style.fontSize = r(e.style.fontSize * k);
      }
    }
  });
}

function onKey(e) {
  const s = state.store;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.shiftKey ? s.redo() : s.undo();
    return;
  }
  if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    s.redo();
    return;
  }
  const el = s.selected;
  if (!el) return;
  if (mod && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    const copy = { ...structuredClone(el), id: s.newId(el.type), x: el.x + 30, y: el.y + 30 };
    s.update((l) => l.pages.find((p) => p.id === s.pageId).elements.push(copy));
    s.select(copy.id);
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    s.update((l) => {
      const page = l.pages.find((p) => p.id === s.pageId);
      page.elements = page.elements.filter((x) => x.id !== el.id);
    });
    s.select(null);
    return;
  }
  if (e.key === 'Escape') {
    s.select(null);
    return;
  }
  const step = e.shiftKey ? 10 : 1;
  const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (d) {
    e.preventDefault();
    s.update((l) => {
      const t = l.pages.find((p) => p.id === s.pageId).elements.find((x) => x.id === el.id);
      t.x += d[0];
      t.y += d[1];
    }, { merge: `nudge:${el.id}` });
  }
}

async function doPublish() {
  await assets.refreshIfStale();
  const rev = await publish(state.projekt, flushSave, assets);
  if (rev) {
    await loadProjects();
    state.projekt = state.projekte.find((p) => p.id === state.projekt.id);
  }
}

boot().catch((e) => {
  app.replaceChildren(h('div.fatal', {}, h('h1', {}, 'Studio konnte nicht geladen werden'), h('p', {}, e.message), h('button.btn', { onclick: () => location.reload() }, 'Neu laden')));
});
