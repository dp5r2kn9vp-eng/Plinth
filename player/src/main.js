'use strict';
// Plinth Player – Electron-Hauptprozess.
// Zwei Betriebsarten:
//   Plinth.exe --watchdog   Überwacht den Player (Autostart startet diese Variante)
//   Plinth.exe              Der Player selbst (Vollbild/Kiosk)

const { app, BrowserWindow, protocol, ipcMain, globalShortcut, safeStorage, powerSaveBlocker } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const { dataDir } = require('./paths');
const { Logger } = require('./logger');
const { Config } = require('./config');
const { Maintenance } = require('./maintenance');
const { SyncEngine } = require('./sync');
const { Watchdog } = require('./watchdog');

const DATA = dataDir();
fs.mkdirSync(DATA, { recursive: true });
const IS_WATCHDOG = process.argv.includes('--watchdog');
const WINDOWED = process.env.PLINTH_WINDOWED === '1' || process.argv.includes('--windowed');
const log = new Logger(path.join(DATA, 'logs'), { echo: !app.isPackaged });
const VERSION = app.getVersion();
const RENDERER_DIR = path.join(__dirname, 'renderer');
const SHARED_DIR = app.isPackaged ? path.join(process.resourcesPath, 'shared') : path.join(__dirname, '..', '..', 'shared');
const SHORTCUT = 'Control+Alt+Shift+K';

// Getrennte Profile, damit Watchdog und Player je eine eigene Einzelinstanz-Sperre haben
app.setPath('userData', path.join(DATA, IS_WATCHDOG ? 'profile-watchdog' : 'profile-player'));

process.on('uncaughtException', (e) => {
  log.error('Unbehandelter Fehler – Neustart durch Watchdog', { error: e.stack ?? String(e) });
  app.exit(1);
});
process.on('unhandledRejection', (e) => log.error('Unbehandelte Promise-Ablehnung', { error: String(e?.stack ?? e) }));

if (IS_WATCHDOG) runWatchdog();
else runPlayer();

// ============================================================ Watchdog

function runWatchdog() {
  if (!app.requestSingleInstanceLock()) {
    app.exit(0);
    return;
  }
  const maintenance = new Maintenance(DATA);
  const args = process.argv.slice(1).filter((a) => a !== '--watchdog');
  const wd = new Watchdog({
    maintenance,
    log,
    spawn: () => {
      const child = spawn(process.execPath, args, { env: { ...process.env, PLINTH_WATCHDOG: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      child.stderr.on('data', () => {}); // Ausgaben verwerfen (Log schreibt der Player selbst)
      return child;
    },
  });
  app.on('second-instance', () => {
    log.info('Plinth manuell gestartet – Wartungsmodus beendet');
    wd.wake();
  });
  app.on('window-all-closed', () => {}); // ohne Fenster weiterlaufen
  app.whenReady().then(() => {
    log.info('Watchdog gestartet', { version: VERSION });
    wd.start();
  });
}

// ============================================================ Player

function runPlayer() {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'plinth', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);

  if (!app.requestSingleInstanceLock()) {
    app.exit(0);
    return;
  }

  let win = null;
  let config = null;
  let sync = null;
  let allowClose = false;
  let unlockedUntil = 0;
  let maintenanceTimer = null;
  let screenState = 'loading';
  let lastContent = null;
  const maintenance = new Maintenance(DATA);

  const send = (channel, payload) => win?.webContents.send(channel, payload);
  const setScreen = (s) => {
    screenState = s;
    send('state', publicState());
  };
  const publicState = () => ({
    screen: screenState,
    hideCursor: config.get('hideCursor'),
    deviceName: config.get('deviceName') ?? os.hostname(),
    version: VERSION,
    shortcut: SHORTCUT,
  });

  app.on('second-instance', () => win?.focus());

  app.whenReady().then(() => {
    config = new Config(DATA, {
      available: () => safeStorage.isEncryptionAvailable(),
      encrypt: (s) => safeStorage.encryptString(s),
      decrypt: (b) => safeStorage.decryptString(b),
    });
    if (!safeStorage.isEncryptionAvailable()) log.warn('Sichere Ablage nicht verfügbar – Token wird unverschlüsselt gespeichert');
    log.info('Player gestartet', { version: VERSION, pid: process.pid, data: DATA, windowed: WINDOWED });

    protocol.handle('plinth', handleProtocol);
    powerSaveBlocker.start('prevent-display-sleep');
    createWindow();
    globalShortcut.register(SHORTCUT, () => send('maintenance:open'));

    if (process.env.PLINTH_WATCHDOG === '1') {
      setInterval(() => process.stdout.write('HB\n'), 10000).unref();
    }
    if (config.token) startSync();
    else provision().then((ok) => ok || setScreen('setup'));
  });

  /**
   * Zero-Touch-Rollout: Der Installer legt provision.json ab ({kundencode, pin, apiUrl?, name?, hideCursor?}).
   * Beim ersten Start richtet sich der Player damit selbst ein; die Datei wird danach gelöscht (enthält Code und PIN).
   */
  async function provision() {
    const file = path.join(DATA, 'provision.json');
    let p;
    try {
      p = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    } catch {
      return false;
    }
    log.info('Automatische Einrichtung aus provision.json');
    const res = await register({ kundencode: p.kundencode, name: p.name || os.hostname(), pin: String(p.pin ?? ''), apiUrl: p.apiUrl, hideCursor: p.hideCursor ?? true });
    if (res.ok) fs.rmSync(file, { force: true });
    else log.error('Automatische Einrichtung fehlgeschlagen', { message: res.message });
    return res.ok;
  }

  app.on('will-quit', () => globalShortcut.unregisterAll());

  function createWindow() {
    win = new BrowserWindow({
      kiosk: !WINDOWED,
      fullscreen: !WINDOWED,
      frame: WINDOWED,
      width: 1280,
      height: 720,
      autoHideMenuBar: true,
      backgroundColor: '#000000',
      show: false,
      title: 'Plinth Player',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        autoplayPolicy: 'no-user-gesture-required',
        spellcheck: false,
      },
    });
    win.setMenu(null);
    win.once('ready-to-show', () => win.show());
    win.loadURL('plinth://app/index.html');

    // Nichts darf aus dem Player herausnavigieren
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.on('close', (e) => {
      if (!allowClose && !WINDOWED) e.preventDefault(); // Alt+F4 im Kiosk ignorieren
    });
    win.webContents.on('render-process-gone', (_e, details) => {
      log.error('Darstellung abgestürzt – wird neu geladen', details);
      setTimeout(() => win.reload(), 1000);
    });
    let unresponsiveTimer = null;
    win.on('unresponsive', () => {
      log.warn('Darstellung reagiert nicht');
      unresponsiveTimer = setTimeout(() => {
        log.error('Darstellung hängt – wird neu gestartet');
        win.webContents.forcefullyCrashRenderer();
        win.reload();
      }, 15000);
    });
    win.on('responsive', () => clearTimeout(unresponsiveTimer));
    win.webContents.on('did-finish-load', () => {
      send('state', publicState());
      if (lastContent) send('content', lastContent);
      if (sync) send('status', sync.status);
    });
  }

  // ---------------------------------------------------------- Inhalte

  function startSync() {
    sync?.stop();
    sync = new SyncEngine({
      dataDir: DATA,
      apiUrl: config.get('apiUrl'),
      token: () => config.token,
      log,
      pollSeconds: config.get('pollSeconds'),
      appVersion: VERSION,
    });
    sync.on('content', (manifest) => {
      lastContent = {
        revision: manifest.revision,
        layout: manifest.layout,
        files: Object.fromEntries(manifest.files.map((f) => [f.id, `plinth://media/${path.basename(f.path)}`])),
      };
      setScreen('player');
      send('content', lastContent);
    });
    sync.on('status', (s) => {
      send('status', s);
      // Wieder entsperrt → Inhalte zeigen
      if (screenState === 'blocked' && !s.blocked && s.online) setScreen(lastContent ? 'player' : 'waiting');
    });
    sync.on('blocked', () => setScreen('blocked'));
    sync.on('unregistered', () => {
      log.warn('Gerät nicht mehr registriert – Einrichtung nötig');
      sync.stop();
      config.token = null;
      setScreen('setup');
    });
    if (screenState !== 'player') setScreen('waiting');
    sync.start();
  }

  /** plinth://app/… → Oberfläche, plinth://app/shared/… → gemeinsamer Renderer, plinth://media/… → Medien (mit Range) */
  async function handleProtocol(request) {
    const url = new URL(request.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    let base;
    let file;
    if (url.host === 'media') {
      base = path.join(DATA, 'media');
      file = path.join(base, path.basename(rel));
    } else if (url.host === 'app' && rel.startsWith('shared/')) {
      base = SHARED_DIR;
      file = path.join(base, rel.slice('shared/'.length));
    } else if (url.host === 'app') {
      base = RENDERER_DIR;
      file = path.join(base, rel || 'index.html');
    } else {
      return new Response('Not found', { status: 404 });
    }
    if (!file.startsWith(base + path.sep)) return new Response('Forbidden', { status: 403 });

    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      return new Response('Not found', { status: 404 });
    }
    const type = mimeOf(file);
    const range = request.headers.get('range');
    const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m && (m[1] || m[2])) {
      let start = m[1] ? Number(m[1]) : stat.size - Number(m[2]);
      let end = m[1] && m[2] ? Number(m[2]) : stat.size - 1;
      start = Math.max(0, start);
      end = Math.min(stat.size - 1, end);
      if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
      return new Response(streamFile(file, start, end), {
        status: 206,
        headers: { 'Content-Type': type, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes' },
      });
    }
    return new Response(streamFile(file, 0, stat.size - 1), {
      status: 200,
      headers: { 'Content-Type': type, 'Content-Length': String(stat.size), 'Accept-Ranges': 'bytes' },
    });
  }

  // ---------------------------------------------------------- IPC

  ipcMain.handle('state:get', () => publicState());

  ipcMain.handle('setup:submit', (_e, input) => register(input));

  async function register(input) {
    const kundencode = String(input?.kundencode ?? '').trim();
    const name = String(input?.name ?? '').trim();
    const pin = String(input?.pin ?? '');
    if (!/^\d{4,8}$/.test(pin)) return { ok: false, message: 'PIN muss 4 bis 8 Ziffern haben.' };
    const apiUrl = (input?.apiUrl || config.get('apiUrl')).replace(/\/$/, '');
    try {
      const res = await fetch(`${apiUrl}/v1/player/registrieren`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kundencode, name, appVersion: VERSION }),
        signal: AbortSignal.timeout(20000),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status !== 201) {
        const msg = data.error?.code === 'invalid_code' ? 'Kundencode ist ungültig.' : data.error?.message ?? `Fehler ${res.status}`;
        log.warn('Einrichtung fehlgeschlagen', { status: res.status, code: data.error?.code });
        return { ok: false, message: msg };
      }
      config.set({ apiUrl, deviceName: name, hideCursor: !!input.hideCursor });
      config.token = data.token;
      config.setPin(pin);
      log.info('Gerät eingerichtet', { geraetId: data.geraetId, name });
      // Neues Gerät: alten lokalen Stand verwerfen, falls vorher einem anderen Kunden zugeordnet
      fs.rmSync(path.join(DATA, 'state.json'), { force: true });
      lastContent = null;
      startSync();
      return { ok: true };
    } catch (e) {
      log.warn('Einrichtung: Server nicht erreichbar', { error: e.message });
      return { ok: false, message: `Server nicht erreichbar (${apiUrl}).` };
    }
  }

  ipcMain.handle('setup:cancel', () => {
    if (config.token) setScreen(lastContent ? 'player' : 'waiting');
  });

  ipcMain.handle('maintenance:pin', (_e, pin) => {
    const result = maintenance.tryPin(String(pin ?? ''), (p) => config.checkPin(p));
    if (result === 'ok') unlockedUntil = Date.now() + 2 * 60 * 1000;
    else log.warn('Falsche Wartungs-PIN');
    return result;
  });

  ipcMain.handle('maintenance:action', async (_e, { action, minutes } = {}) => {
    if (Date.now() > unlockedUntil) return { ok: false };
    unlockedUntil = Date.now() + 2 * 60 * 1000;
    switch (action) {
      case 'quit':
        log.info('Player per Wartungsmenü beendet');
        maintenance.enter('quit');
        allowClose = true;
        app.quit();
        return { ok: true };
      case 'timed': {
        const min = Math.min(240, Math.max(1, Number(minutes) || 15));
        log.info('Wartungsmodus', { minutes: min });
        maintenance.enter('timed', min);
        win.setKiosk(false);
        win.setFullScreen(false);
        win.minimize();
        clearTimeout(maintenanceTimer);
        maintenanceTimer = setTimeout(endMaintenance, min * 60000);
        return { ok: true };
      }
      case 'setup':
        setScreen('setup');
        return { ok: true };
      case 'sync':
        await sync?.checkNow();
        return { ok: true, status: sync?.status };
      case 'cursor':
        config.set({ hideCursor: !config.get('hideCursor') });
        send('state', publicState());
        return { ok: true };
      case 'info':
        return {
          ok: true,
          info: {
            version: VERSION,
            deviceName: config.get('deviceName'),
            apiUrl: config.get('apiUrl'),
            dataDir: DATA,
            status: sync?.status ?? null,
            revision: lastContent?.revision ?? null,
            log: log.recent.slice(-40),
          },
        };
      default:
        return { ok: false };
    }
  });

  ipcMain.on('renderer:error', (_e, msg) => log.error('Darstellung', { message: String(msg).slice(0, 500) }));

  function endMaintenance() {
    log.info('Wartungsmodus beendet');
    maintenance.clear();
    if (!WINDOWED) {
      win.restore();
      win.setFullScreen(true);
      win.setKiosk(true);
    }
    win.focus();
  }
}

// ============================================================ Hilfen

/** Datei als Web-Stream mit Gegendruck (große Videos werden nicht komplett in den Speicher gelesen). */
function streamFile(file, start, end) {
  return Readable.toWeb(fs.createReadStream(file, { start, end }));
}

function mimeOf(file) {
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
  }[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}
