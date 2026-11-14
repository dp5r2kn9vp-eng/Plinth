'use strict';
// Plinth Studio Desktop – Designer ohne Server (Windows und macOS).
// Startet den lokalen Studio-Server auf 127.0.0.1 und zeigt die Studio-Oberfläche in einem Fenster.
// Projekte und Medien liegen im Benutzerordner:
//   Windows: %APPDATA%\Plinth Studio\daten     macOS: ~/Library/Application Support/Plinth Studio/daten
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createStudioServer } = require('./server');

const RES = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', '..');
const STUDIO_DIR = path.join(RES, 'studio');
const SHARED_DIR = path.join(RES, 'shared');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win = null;
  let url = null;

  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    const dataDir = process.env.PLINTH_STUDIO_DATA || path.join(app.getPath('userData'), 'daten');
    fs.mkdirSync(dataDir, { recursive: true });
    const logFile = path.join(dataDir, 'studio.log');
    const log = { error: (m) => fs.appendFile(logFile, `${new Date().toISOString()} ${m}\n`, () => {}) };
    const studio = createStudioServer({ dataDir, studioDir: STUDIO_DIR, sharedDir: SHARED_DIR, version: app.getVersion(), log });
    let port;
    try {
      port = await studio.listen(0);
    } catch (e) {
      dialog.showErrorBox('Plinth Studio', `Der lokale Dienst konnte nicht starten: ${e.message}`);
      app.quit();
      return;
    }
    url = `http://127.0.0.1:${port}/studio/`;
    buildMenu(dataDir);
    createWindow();
    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().length) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  function createWindow() {
    win = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 1100,
      minHeight: 700,
      title: 'Plinth Studio',
      backgroundColor: '#0e1116',
      show: false,
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
    });
    win.once('ready-to-show', () => win.show());
    win.loadURL(url);
    // Externe Links im Browser öffnen, das Fenster bleibt beim Studio
    win.webContents.setWindowOpenHandler(({ url: target }) => {
      if (/^https?:\/\//.test(target) && !target.startsWith(url)) shell.openExternal(target);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, target) => {
      if (!target.startsWith(`${new URL(url).origin}/`)) {
        e.preventDefault();
        if (/^https?:\/\//.test(target)) shell.openExternal(target);
      }
    });
    // Ungespeicherte Änderungen: das Studio fragt per beforeunload nach
    win.webContents.on('will-prevent-unload', (e) => {
      const choice = dialog.showMessageBoxSync(win, {
        type: 'question',
        buttons: ['Trotzdem schließen', 'Abbrechen'],
        defaultId: 1,
        cancelId: 1,
        message: 'Es gibt noch nicht gespeicherte Änderungen.',
        detail: 'Das Studio speichert automatisch nach kurzer Zeit. Jetzt schließen verwirft die letzten Änderungen.',
      });
      if (choice === 0) e.preventDefault();
    });
    win.on('closed', () => {
      win = null;
    });
  }

  function buildMenu(dataDir) {
    const isMac = process.platform === 'darwin';
    const template = [
      ...(isMac ? [{ role: 'appMenu' }] : []),
      {
        label: 'Datei',
        submenu: [
          { label: 'Datenordner öffnen', click: () => shell.openPath(dataDir) },
          { type: 'separator' },
          isMac ? { role: 'close', label: 'Fenster schließen' } : { role: 'quit', label: 'Beenden' },
        ],
      },
      { role: 'editMenu', label: 'Bearbeiten' },
      {
        label: 'Ansicht',
        submenu: [
          { role: 'reload', label: 'Neu laden' },
          { role: 'toggleDevTools', label: 'Entwicklerwerkzeuge' },
          { type: 'separator' },
          { role: 'resetZoom', label: 'Originalgröße' },
          { role: 'zoomIn', label: 'Vergrößern' },
          { role: 'zoomOut', label: 'Verkleinern' },
          { type: 'separator' },
          { role: 'togglefullscreen', label: 'Vollbild' },
        ],
      },
      { role: 'windowMenu', label: 'Fenster' },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }
}
