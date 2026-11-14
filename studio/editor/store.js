// Zustand des Editors: Layout, aktuelle Seite, Auswahl, Rückgängig/Wiederholen.

const LIMIT = 200;
const MERGE_MS = 800;

export const VIDEO_PAGE = '__video';

export class Store extends EventTarget {
  constructor(layout) {
    super();
    this.layout = layout;
    this.undoStack = [];
    this.redoStack = [];
    this.selection = null;
    this.pageId = layout.pages[0].id;
    this.lastMerge = null;
  }

  get page() {
    return this.layout.pages.find((p) => p.id === this.pageId) ?? null;
  }

  get selected() {
    return this.page?.elements.find((e) => e.id === this.selection) ?? null;
  }

  emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  /**
   * Ändert das Layout. Aufeinanderfolgende Änderungen mit gleichem merge-Schlüssel
   * (z. B. Tippen in ein Feld) werden zu einem Rückgängig-Schritt zusammengefasst.
   */
  update(mutate, { merge = null } = {}) {
    const now = Date.now();
    const mergeable = merge && this.lastMerge && this.lastMerge.key === merge && now - this.lastMerge.at < MERGE_MS;
    if (!mergeable) {
      this.undoStack.push(structuredClone(this.layout));
      if (this.undoStack.length > LIMIT) this.undoStack.shift();
    }
    this.lastMerge = merge ? { key: merge, at: now } : null;
    this.redoStack = [];
    mutate(this.layout);
    this.emit('change', { source: 'edit' });
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(structuredClone(this.layout));
    this.layout = this.undoStack.pop();
    this.afterHistory();
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(structuredClone(this.layout));
    this.layout = this.redoStack.pop();
    this.afterHistory();
  }

  afterHistory() {
    this.lastMerge = null;
    if (this.pageId !== VIDEO_PAGE && !this.page) this.pageId = this.layout.pages[0].id;
    if (!this.selected) this.selection = null;
    this.emit('change', { source: 'history' });
    this.emit('select');
  }

  /** Neues Layout von außen (Laden, Konflikt): Verlauf leeren. */
  replace(layout) {
    this.layout = layout;
    this.undoStack = [];
    this.redoStack = [];
    this.lastMerge = null;
    if (this.pageId !== VIDEO_PAGE && !this.page) this.pageId = layout.pages[0].id;
    if (!this.selected) this.selection = null;
    this.emit('change', { source: 'load' });
    this.emit('select');
  }

  select(id) {
    if (this.selection === id) return;
    this.selection = id;
    this.emit('select');
  }

  setPage(id) {
    this.pageId = id;
    this.selection = null;
    this.emit('page');
    this.emit('select');
  }

  /** Eindeutige ID mit Präfix */
  newId(prefix) {
    const used = new Set(this.layout.pages.flatMap((p) => [p.id, ...p.elements.map((e) => e.id)]));
    let i = 1;
    while (used.has(`${prefix}${i}`)) i++;
    return `${prefix}${i}`;
  }
}
