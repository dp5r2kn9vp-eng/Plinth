// Plinth Player – Oberfläche. Zeigt Inhalte mit dem gemeinsamen Renderer, Einrichtung und Wartungsmenü.
import { PlinthRuntime } from './shared/renderer/runtime.js';

const $ = (id) => document.getElementById(id);
const api = window.plinth;
let runtime = null;
let state = null;
let status = {};

window.addEventListener('error', (e) => api.reportError(e.message));
window.addEventListener('unhandledrejection', (e) => api.reportError(String(e.reason)));

// ---------- Zustand ----------

function applyState(s) {
  state = s;
  document.body.classList.toggle('hide-cursor', !!s.hideCursor);
  $('setup-shortcut').textContent = s.shortcut.replaceAll('+', ' + ');
  $('waiting-device').textContent = `${s.deviceName} · Version ${s.version}`;
  for (const id of ['setup', 'waiting', 'blocked']) $(id).classList.add('hidden');
  if (s.screen === 'setup') showSetup();
  if (s.screen === 'waiting') $('waiting').classList.remove('hidden');
  if (s.screen === 'blocked') $('blocked').classList.remove('hidden');
}

api.on('state', applyState);
api.getState().then(applyState);

api.on('content', ({ layout, files }) => {
  const asset = (ref) => files[ref] ?? null;
  if (!runtime) {
    runtime = new PlinthRuntime($('screen'), {
      layout,
      asset,
      onEvent: (type, d) => {
        if (type === 'error') api.reportError(d.message);
      },
    });
    runtime.start();
  } else {
    runtime.replace(layout, { asset });
  }
  $('waiting').classList.add('hidden');
});

api.on('status', (s) => {
  status = s;
  const ind = $('indicator');
  ind.className = 'indicator';
  if (s.download) ind.classList.add('loading');
  else if (s.blocked || (s.lastError && s.online)) ind.classList.add('error');
  else if (s.online === false) ind.classList.add('offline');
  else ind.classList.add('hidden');
  ind.title = s.lastError ?? '';

  if (s.download) {
    const pct = s.download.total ? Math.round((s.download.done / s.download.total) * 100) : 0;
    $('waiting-text').textContent = `Inhalte werden geladen … ${pct} %`;
    $('waiting-bar').classList.remove('hidden');
    $('waiting-bar').firstElementChild.style.width = `${pct}%`;
  } else if (s.online === false) {
    $('waiting-text').textContent = 'Keine Verbindung zum Server – neuer Versuch läuft automatisch.';
    $('waiting-bar').classList.add('hidden');
  } else if (s.revision == null && s.online) {
    $('waiting-text').textContent = 'Verbunden. Es wurde noch nichts veröffentlicht.';
    $('waiting-bar').classList.add('hidden');
  }
});

// ---------- Einrichtung ----------

function showSetup() {
  const form = $('setup-form');
  $('setup').classList.remove('hidden');
  $('setup-cancel').classList.toggle('hidden', !runtime && state.screen !== 'player');
  if (!form.name.value) form.name.value = state.deviceName ?? '';
  form.kundencode.focus();
}

$('setup-form').kundencode.addEventListener('input', (e) => {
  const raw = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  e.target.value = raw.match(/.{1,4}/g)?.join('-') ?? '';
});

$('setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const err = $('setup-error');
  err.classList.add('hidden');
  if (f.pin.value !== f.pin2.value) {
    err.textContent = 'Die PINs stimmen nicht überein.';
    err.classList.remove('hidden');
    return;
  }
  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = 'Wird eingerichtet …';
  const res = await api.submitSetup({
    kundencode: f.kundencode.value,
    name: f.name.value,
    pin: f.pin.value,
    hideCursor: f.hideCursor.checked,
    apiUrl: f.apiUrl.value || undefined,
  });
  btn.disabled = false;
  btn.textContent = 'Einrichten';
  if (!res.ok) {
    err.textContent = res.message;
    err.classList.remove('hidden');
    return;
  }
  f.reset();
  $('setup').classList.add('hidden');
});

$('setup-cancel').addEventListener('click', () => {
  $('setup').classList.add('hidden');
  api.cancelSetup();
});

// ---------- Wartung ----------

let closeTimer = null;
function openMaintenance() {
  if (state?.screen === 'setup') return;
  $('maintenance').classList.remove('hidden');
  $('pin-card').classList.remove('hidden');
  $('menu-card').classList.add('hidden');
  $('info').classList.add('hidden');
  $('pin-input').value = '';
  $('pin-input').focus();
  touchMaintenance();
}

function closeMaintenance() {
  clearTimeout(closeTimer);
  $('maintenance').classList.add('hidden');
}

// Ohne Bedienung schließt sich das Menü nach 30 s
function touchMaintenance() {
  clearTimeout(closeTimer);
  closeTimer = setTimeout(closeMaintenance, 30000);
}

api.on('maintenance:open', openMaintenance);
$('maintenance').addEventListener('pointerdown', touchMaintenance);
$('maintenance').addEventListener('keydown', touchMaintenance);
for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', closeMaintenance);

// Touch-Alternative zur Tastenkombination: 5× schnell in die Ecke oben links tippen
let taps = [];
document.addEventListener('pointerdown', (e) => {
  if (e.clientX > 90 || e.clientY > 90) {
    taps = [];
    return;
  }
  const now = performance.now();
  taps = taps.filter((t) => now - t < 3000);
  taps.push(now);
  if (taps.length >= 5) {
    taps = [];
    openMaintenance();
  }
}, { capture: true, passive: true });

const keypad = $('keypad');
for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK']) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = k;
  b.addEventListener('click', () => {
    const input = $('pin-input');
    if (k === '⌫') input.value = input.value.slice(0, -1);
    else if (k === 'OK') submitPin();
    else if (input.value.length < 8) input.value += k;
  });
  keypad.appendChild(b);
}
$('pin-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitPin();
  if (e.key === 'Escape') closeMaintenance();
});

async function submitPin() {
  const input = $('pin-input');
  const result = await api.checkPin(input.value);
  input.value = '';
  if (result === 'ok') {
    $('pin-card').classList.add('hidden');
    $('menu-card').classList.remove('hidden');
    return;
  }
  // Kein Hinweis, ob falsch oder gesperrt
  const card = $('pin-card');
  card.classList.remove('shake');
  void card.offsetWidth;
  card.classList.add('shake');
}

for (const b of document.querySelectorAll('[data-action]')) {
  b.addEventListener('click', async () => {
    const action = b.dataset.action;
    const res = await api.action(action, { minutes: Number(b.dataset.minutes) || undefined });
    if (!res.ok) {
      openMaintenance(); // Freischaltung abgelaufen
      return;
    }
    if (action === 'info') {
      const i = res.info;
      const s = i.status ?? {};
      $('info').textContent = [
        `Gerät: ${i.deviceName ?? '–'}   Version: ${i.version}`,
        `Server: ${i.apiUrl}`,
        `Daten: ${i.dataDir}`,
        `Revision: ${i.revision ?? '–'}   Online: ${s.online ?? '–'}   Letzte Prüfung: ${s.lastCheck ? new Date(s.lastCheck).toLocaleString('de-DE') : '–'}`,
        `Fehler: ${s.lastError ?? 'keine'}`,
        '',
        ...i.log,
      ].join('\n');
      $('info').classList.remove('hidden');
    } else if (action === 'sync') {
      b.textContent = `Jetzt synchronisieren (${res.status?.lastError ? `Fehler: ${res.status.lastError}` : 'OK'})`;
    } else {
      closeMaintenance();
    }
  });
}
