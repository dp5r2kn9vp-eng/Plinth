'use strict';
// Ende-zu-Ende-Tests des Electron-Players gegen eine laufende Installation.
// xvfb-run -a env PLINTH_URL=http://localhost:8099 MEDIA_DIR=/pfad/mit/film.mp4 node --test test/e2e/player.e2e.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { _electron: electron } = require('playwright');
const { Studio, BASE } = require('../helpers');

const skip = (!BASE || !process.env.MEDIA_DIR) && 'PLINTH_URL/MEDIA_DIR nicht gesetzt';
const APP = path.join(__dirname, '..', '..');
const ELECTRON = require('electron');
const sandboxArgs = process.getuid?.() === 0 ? ['--no-sandbox'] : [];

let studio, projekt, kundencode, film, dataDir, app, page;
const DEVICE = `E2E-Player-${Date.now()}`;

async function launch(env = {}) {
  app = await electron.launch({
    executablePath: ELECTRON,
    args: [APP, ...sandboxArgs],
    env: { ...process.env, PLINTH_DATA_DIR: dataDir, PLINTH_WINDOWED: '1', PLINTH_API_URL: `${BASE}/api`, ...env },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return page;
}

async function close() {
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  app = null;
}

async function publishLayout(mutate) {
  return studio.publish(projekt.id, mutate);
}

before(async () => {
  if (skip) return;
  studio = new Studio();
  await studio.login();
  projekt = await studio.project(`Player-E2E ${Date.now()}`);
  film = await studio.upload('film.mp4', 'video/mp4', fs.readFileSync(path.join(process.env.MEDIA_DIR, 'film.mp4')));
  await publishLayout((l) => {
    l.idleTimeoutSeconds = 0;
    l.pages[0].elements.push(
      { id: 'titel', type: 'text', x: 100, y: 60, w: 1200, h: 120, text: 'Version eins', style: { fontSize: 80, color: '#ffffff' } },
      { id: 'film', type: 'thumbnail', x: 560, y: 300, w: 800, h: 450, video: film.ref, title: 'Testfilm' },
    );
  });
  kundencode = (await studio.call('GET', '/kunde')).kunde.kundencode;
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plinth-player-'));
  // schnelles Polling für den Test
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ pollSeconds: 2 }));
});

after(close);

test('Einrichtung mit Kundencode, Inhalte erscheinen', { skip }, async () => {
  await launch();
  await page.waitForSelector('#setup:not(.hidden)');
  await page.fill('input[name=kundencode]', 'AAAA-BBBB-CCCC');
  await page.fill('input[name=name]', DEVICE);
  await page.fill('input[name=pin]', '2468');
  await page.fill('input[name=pin2]', '2468');
  await page.click('button[type=submit]');
  await page.waitForSelector('#setup-error:not(.hidden)');
  assert.match(await page.textContent('#setup-error'), /ungültig/);

  await page.fill('input[name=kundencode]', kundencode.toLowerCase().replaceAll('-', ''));
  assert.equal(await page.inputValue('input[name=kundencode]'), kundencode, 'Eingabe wird formatiert');
  await page.click('button[type=submit]');
  await page.waitForSelector('#setup.hidden', { state: 'attached' });

  // Gerät dem Testprojekt zuordnen
  const { geraete } = await studio.call('GET', '/geraete');
  const dev = geraete.find((g) => g.name === DEVICE);
  await studio.call('PATCH', `/geraete/${dev.id}`, { projektId: projekt.id });

  await page.waitForSelector('.plinth-text:has-text("Version eins")', { timeout: 30000 });
  const cfg = fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8');
  assert.ok(!cfg.includes('2468'), 'PIN nicht im Klartext');
});

test('Video abspielen (H.264), nach Ende zurück zur Startseite', { skip }, async () => {
  await page.click('.plinth-thumbnail');
  await page.waitForSelector('video.plinth-video');
  await page.waitForFunction(() => document.querySelector('video.plinth-video')?.currentTime > 0.5, null, { timeout: 15000 });
  assert.match(await page.textContent('.plinth-video-header'), /Testfilm/);
  await page.waitForSelector('.plinth-thumbnail', { timeout: 20000 });
});

test('Zurück-Button beendet das Video', { skip }, async () => {
  await page.click('.plinth-thumbnail');
  await page.waitForSelector('video.plinth-video');
  await page.click('.plinth-back');
  await page.waitForSelector('.plinth-thumbnail');
});

test('Neue Veröffentlichung wird automatisch übernommen', { skip }, async () => {
  await publishLayout((l) => {
    l.pages[0].elements[0].text = 'Version zwei';
  });
  await page.waitForSelector('.plinth-text:has-text("Version zwei")', { timeout: 30000 });
});

test('Wartungsmenü: Ecke antippen, falsche PIN ohne Hinweis, richtige PIN öffnet Menü', { skip }, async () => {
  for (let i = 0; i < 5; i++) await page.mouse.click(20, 20);
  await page.waitForSelector('#maintenance:not(.hidden)');
  await page.fill('#pin-input', '0000');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  assert.equal(await page.isVisible('#menu-card'), false);
  assert.equal(await page.isVisible('.error'), false);
  await page.fill('#pin-input', '2468');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#menu-card:not(.hidden)');
  await page.click('[data-action=info]');
  await page.waitForSelector('#info:not(.hidden)');
  assert.ok((await page.textContent('#info')).includes(DEVICE));
  await page.click('#menu-card [data-close]');
  await page.waitForSelector('#maintenance.hidden', { state: 'attached' });
});

test('Gesperrt → Sperrbildschirm, entsperrt → Inhalte', { skip }, async () => {
  const { geraete } = await studio.call('GET', '/geraete');
  const dev = geraete.find((g) => g.name === DEVICE);
  await studio.call('PATCH', `/geraete/${dev.id}`, { gesperrt: true });
  await page.waitForSelector('#blocked:not(.hidden)', { timeout: 15000 });
  await studio.call('PATCH', `/geraete/${dev.id}`, { gesperrt: false });
  await page.waitForSelector('#blocked.hidden', { state: 'attached', timeout: 15000 });
  assert.equal(await page.isVisible('.plinth-text:has-text("Version zwei")'), true);
  const { geraete: g2 } = await studio.call('GET', '/geraete');
  assert.ok(g2.find((g) => g.id === dev.id).geladeneRevision >= 2, 'Revision zurückgemeldet');
});

test('Absturz der Darstellung: lädt neu und zeigt wieder Inhalte', { skip }, async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
  await new Promise((r) => setTimeout(r, 3000));
  const reloaded = await app.evaluate(async ({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    for (let i = 0; i < 50 && (wc.isCrashed() || wc.isLoading()); i++) await new Promise((r) => setTimeout(r, 200));
    return wc.executeJavaScript('document.querySelector(".plinth-text")?.textContent ?? null');
  });
  assert.equal(reloaded, 'Version zwei');
});

test('Offline-Start zeigt den letzten Stand', { skip }, async () => {
  await close();
  await launch({ PLINTH_API_URL: 'http://127.0.0.1:9/api' });
  await page.waitForSelector('.plinth-text:has-text("Version zwei")', { timeout: 15000 });
  await page.waitForSelector('#indicator.offline', { state: 'attached', timeout: 15000 });
});

test('Beenden über das Wartungsmenü setzt den Wartungs-Flag', { skip }, async () => {
  for (let i = 0; i < 5; i++) await page.mouse.click(20, 20);
  await page.fill('#pin-input', '2468');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#menu-card:not(.hidden)');
  const exited = new Promise((r) => app.process().once('exit', r));
  await page.click('[data-action=quit]');
  await exited;
  app = null;
  const flag = JSON.parse(fs.readFileSync(path.join(dataDir, 'maintenance.json'), 'utf8'));
  assert.equal(flag.mode, 'quit');
});

function lastPidSafe(logFile) {
  const m = [...fs.readFileSync(logFile, 'utf8').matchAll(/Player gestartet \{"version":"[^"]+","pid":(\d+)/g)].at(-1);
  return m ? Number(m[1]) : 0;
}

test('Zero-Touch: provision.json richtet das Gerät ohne Eingabe ein', { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plinth-prov-'));
  const name = `Provisioniert-${Date.now()}`;
  fs.writeFileSync(path.join(dir, 'provision.json'), JSON.stringify({ kundencode, pin: '1357', name }));
  const prev = dataDir;
  dataDir = dir;
  try {
    await launch();
    await page.waitForSelector('#setup.hidden', { state: 'attached' });
    const { geraete } = await studio.call('GET', '/geraete');
    assert.ok(geraete.some((g) => g.name === name));
    assert.equal(fs.existsSync(path.join(dir, 'provision.json')), false, 'Datei mit Code/PIN gelöscht');
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
    assert.ok(cfg.token && cfg.pin);
  } finally {
    await close();
    dataDir = prev;
  }
});

test('Watchdog: Neustart nach Absturz, keiner im Wartungsmodus, manueller Start beendet Wartung', { skip }, async () => {
  fs.rmSync(path.join(dataDir, 'maintenance.json'), { force: true });
  const logFile = path.join(dataDir, 'logs', 'player.log');
  const count = (re) => (fs.readFileSync(logFile, 'utf8').match(re) ?? []).length;
  const until = async (fn, ms = 20000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (fn()) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('Zeitüberschreitung');
  };
  const env = { ...process.env, PLINTH_DATA_DIR: dataDir, PLINTH_WINDOWED: '1', PLINTH_API_URL: `${BASE}/api` };
  const startCount = count(/Player gestartet/g);
  const wd = spawn(ELECTRON, [APP, '--watchdog', ...sandboxArgs], { env, stdio: 'ignore' });
  try {
    await until(() => count(/Player gestartet/g) === startCount + 1);
    // Player-Prozess hart beenden → Watchdog startet neu
    const lastPid = () => Number([...fs.readFileSync(logFile, 'utf8').matchAll(/Player gestartet \{"version":"[^"]+","pid":(\d+)/g)].at(-1)[1]);
    process.kill(lastPid(), 'SIGKILL');
    await until(() => count(/Player beendet – Neustart/g) >= 1);
    await until(() => count(/Player gestartet/g) === startCount + 2);

    // Wartungsmodus "Beenden" → kein Neustart
    const { Maintenance } = require('../../src/maintenance');
    new Maintenance(dataDir).enter('quit');
    process.kill(lastPid(), 'SIGKILL');
    await until(() => count(/im Wartungsmodus beendet/g) >= 1);
    await new Promise((r) => setTimeout(r, 4000));
    assert.equal(count(/Player gestartet/g), startCount + 2, 'kein Neustart im Wartungsmodus');

    // Manueller Start (zweite Instanz) → Wartung endet, Player startet
    const second = spawn(ELECTRON, [APP, '--watchdog', ...sandboxArgs], { env, stdio: 'ignore' });
    await until(() => count(/manuell gestartet/g) >= 1);
    await until(() => count(/Player gestartet/g) === startCount + 3);
    second.kill();
  } finally {
    wd.kill();
    try {
      process.kill(lastPidSafe(logFile), 'SIGKILL');
    } catch {
      // schon beendet
    }
  }
});
