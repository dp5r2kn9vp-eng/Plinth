// Minimaler DOM-Helfer: h('button.primary', { onclick }, 'Text')

export function h(spec, props = {}, ...children) {
  const [tag, ...classes] = spec.split('.');
  const el = document.createElement(tag || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && k !== 'list' && k !== 'form') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < units.length - 1);
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}

export function formatDuration(s) {
  if (s == null) return '';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}

export function debounce(fn, ms) {
  let t;
  const d = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  d.flush = () => {
    clearTimeout(t);
    return fn();
  };
  d.cancel = () => clearTimeout(t);
  return d;
}

let toastBox;
export function toast(message, kind = 'info', ms = 4000) {
  toastBox ??= document.body.appendChild(h('div.toasts', { role: 'status', 'aria-live': 'polite' }));
  const t = h(`div.toast.${kind}`, {}, message);
  toastBox.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

/** Modaler Dialog; liefert ein Promise mit dem Rückgabewert von onOk oder null bei Abbruch. */
export function dialog(title, body, { ok = 'OK', cancel = 'Abbrechen', danger = false, onOk } = {}) {
  return new Promise((resolve) => {
    const dlg = h('dialog.dialog');
    const okBtn = h(`button.btn${danger ? '.danger' : '.primary'}`, { type: 'submit' }, ok);
    const form = h('form', { method: 'dialog' },
      h('h2', {}, title),
      h('div.dialog-body', {}, body),
      h('div.dialog-actions', {},
        cancel ? h('button.btn', { type: 'button', onclick: () => dlg.close('cancel') }, cancel) : null,
        okBtn));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const v = onOk ? await onOk(form) : true;
        if (v === false) return;
        resolve(v);
        dlg.close('ok');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    dlg.addEventListener('close', () => {
      if (dlg.returnValue !== 'ok') resolve(null);
      dlg.remove();
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
  });
}
