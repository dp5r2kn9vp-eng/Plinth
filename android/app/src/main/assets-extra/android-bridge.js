// Android-Brücke: stellt dieselbe Schnittstelle wie der Electron-Preload (window.plinth) bereit,
// spricht aber per HTTP mit dem lokalen Kern (127.0.0.1, /app-api/…). Dadurch bleibt player.js unverändert.
(() => {
  const listeners = {};
  const last = {};
  let v = -1;
  const emit = (channel, payload) => (listeners[channel] || []).forEach((cb) => {
    try { cb(payload); } catch (e) { report(e.message); }
  });
  const post = (p, body) => fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then((r) => (r.status === 204 ? null : r.json()));
  const report = (m) => fetch('/app-api/error', { method: 'POST', body: String(m).slice(0, 2000) }).catch(() => {});
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function deliver(d) {
    for (const key of ['state', 'content', 'status']) {
      if (d[key] == null) continue;
      const s = JSON.stringify(d[key]);
      if (s !== last[key]) {
        last[key] = s;
        emit(key, d[key]);
      }
    }
  }

  async function loop() {
    for (;;) {
      try {
        const d = await (await fetch(`/app-api/poll?v=${v}`, { cache: 'no-store' })).json();
        v = d.v;
        deliver(d);
      } catch (e) {
        await sleep(1000);
      }
    }
  }

  window.plinth = {
    getState: async () => (await (await fetch('/app-api/poll?v=-2', { cache: 'no-store' })).json()).state,
    submitSetup: async () => ({ ok: false, message: 'Die Cloud-Anbindung folgt in einer späteren Version. Bitte Plinth Studio im lokalen Netz verwenden.' }),
    cancelSetup: async () => {},
    checkPin: async (pin) => (await post('/app-api/pin', { pin })).result,
    action: (action, extra = {}) => post('/app-api/action', { action, ...extra }),
    reportError: report,
    alive: () => fetch('/app-api/alive', { method: 'POST' }).catch(() => {}),
    on: (channel, cb) => {
      (listeners[channel] = listeners[channel] || []).push(cb);
    },
  };

  // Von der App aufgerufen (Menü-Taste der Fernbedienung)
  window.__plinthOpenMaintenance = () => emit('maintenance:open');
  // Tastatur: wie unter Windows Strg+Alt+Umschalt+K
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey && e.altKey && e.shiftKey && e.key.toLowerCase() === 'k') || e.key === 'ContextMenu') emit('maintenance:open');
  });

  document.addEventListener('DOMContentLoaded', () => {
    // Android: Cloud-Einrichtung gibt es (noch) nicht, „Windows nutzen“ heißt hier „Android-Einstellungen“
    const style = document.createElement('style');
    style.textContent = '[data-action="setup"],[data-action="offline"],[data-action="cursor"]{display:none!important}';
    document.head.appendChild(style);
    for (const b of document.querySelectorAll('[data-action="timed"]')) b.textContent = b.textContent.replace('Windows nutzen', 'Android-Einstellungen');
    loop();
  });
})();
