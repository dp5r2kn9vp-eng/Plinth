// Ende-zu-Ende-Tests für Plinth Studio gegen eine laufende Installation (API + Studio + S3).
// Start: PLINTH_URL=http://localhost:8099 PLINTH_EMAIL=… PLINTH_PASSWORD=… MEDIA_DIR=… node --test tests/e2e/studio.e2e.mjsstudio.e2e.mjs
// MEDIA_DIR braucht film.webm, hintergrund.jpg (siehe tests/e2e/README.md).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFileSync, mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.PLINTH_URL ?? 'http://localhost:8099';
const EMAIL = process.env.PLINTH_EMAIL ?? 'praxis@plinth.test';
const PASSWORD = process.env.PLINTH_PASSWORD ?? 'Demo-Passwort-2026';
const MEDIA = process.env.MEDIA_DIR ?? new URL('../fixtures', import.meta.url).pathname;

// Testmedien pro Lauf eindeutig benennen, damit Ergebnisse früherer Läufe nicht stören
const RUN = Date.now().toString(36);
const FILM = `film-${RUN}.webm`;
const BG = `hintergrund-${RUN}.jpg`;
const runMedia = mkdtempSync(join(tmpdir(), 'plinth-media-'));
copyFileSync(join(MEDIA, 'film.webm'), join(runMedia, FILM));
copyFileSync(join(MEDIA, 'hintergrund.jpg'), join(runMedia, BG));

let browser;
before(async () => {
  browser = await chromium.launch();
});
after(async () => browser?.close());

async function login(context) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/studio/login.html`);
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.click('#submit');
  await page.waitForSelector('.editor-stage');
  return { page, errors };
}

async function api(page, method, path, body) {
  return page.evaluate(async ([m, p, b]) => {
    const r = await fetch(`/api/v1${p}`, { method: m, headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined });
    return r.status === 204 ? null : r.json();
  }, [method, path, body]);
}

/** Frisches Projekt, damit Tests unabhängig voneinander laufen */
async function freshProject(page, ausrichtung = 'landscape') {
  const { projekt } = await api(page, 'POST', '/projekte', { name: `E2E ${Date.now()}`, ausrichtung });
  await page.goto(`${BASE}/studio/?projekt=${projekt.id}`);
  await page.waitForSelector('.editor-stage');
  return projekt;
}

async function ensureMedia(page) {
  const { dateien } = await api(page, 'GET', '/dateien');
  if (dateien.some((d) => d.name === FILM) && dateien.some((d) => d.name === BG)) return;
  await page.setInputFiles('.library input[type=file]', [join(runMedia, FILM), join(runMedia, BG)]);
  await page.waitForFunction(([a, b]) => {
    const names = [...document.querySelectorAll('.lib-name')].map((n) => n.textContent);
    return names.includes(a) && names.includes(b) && !document.querySelector('.job');
  }, [FILM, BG], { timeout: 60000 });
}

test('Login-Seite zeigt Fehler bei falschem Passwort', async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/studio/login.html`);
  await page.fill('#email', EMAIL);
  await page.fill('#password', 'falsch-falsch');
  await page.click('#submit');
  await page.waitForSelector('#error.show');
  assert.match(await page.textContent('#error'), /falsch/);
  await ctx.close();
});

test('Ohne Anmeldung leitet das Studio zur Login-Seite', async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/studio/`);
  await page.waitForURL('**/login.html');
  await ctx.close();
});

test('Gestalten, Autosave, Rückgängig, Vorschau und Veröffentlichen', { skip: !MEDIA && 'MEDIA_DIR fehlt' }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { page, errors } = await login(ctx);
  await ensureMedia(page);
  const projekt = await freshProject(page);

  // Upload hat Standbild und Abmessungen erzeugt
  const { dateien } = await api(page, 'GET', '/dateien');
  const film = dateien.find((d) => d.name === FILM);
  assert.ok(film.vorschauDateiId, 'Standbild erzeugt');
  assert.equal(film.breite, 640);
  assert.ok(film.dauerSekunden > 3);

  // Hintergrundbild, Video-Thumbnail, Text
  await page.locator('.inspector label.field:has-text("Bild") select').selectOption({ label: BG });
  await page.locator('.lib-item', { hasText: FILM }).getByRole('button', { name: 'Einfügen' }).click();
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.locator('.inspector textarea').fill('Herzlich willkommen');

  // Ziehen mit Einrasten an der linken Bühnenkante
  const stage = await page.locator('.editor-stage').boundingBox();
  const el = page.locator('.editor-stage .plinth-text');
  const b = await el.boundingBox();
  await page.mouse.move(b.x + 10, b.y + 10);
  await page.mouse.down();
  await page.mouse.move(stage.x + 12, b.y + 10, { steps: 10 });
  await page.mouse.up();
  assert.equal(await page.locator('.inspector input[type=number]').first().inputValue(), '0', 'rastet bei x=0 ein');

  // Rückgängig / Wiederholen
  await page.locator('[data-testid=canvas]').focus();
  await page.keyboard.press('Control+z');
  assert.notEqual(await page.locator('.inspector input[type=number]').first().inputValue(), '0');
  await page.keyboard.press('Control+Shift+z');
  assert.equal(await page.locator('.inspector input[type=number]').first().inputValue(), '0');

  // Zweite Seite mit Button, Startseite verlinkt dorthin
  await page.getByRole('button', { name: '+ Seite' }).click();
  await page.locator('.page-tab', { hasText: 'Startseite' }).click();
  await page.getByRole('button', { name: 'Button', exact: true }).click();
  await page.locator('.inspector label.field:has-text("Y") input').fill('900');

  // Videoseite anpassen
  await page.locator('.page-tab', { hasText: 'Videoseite' }).click();
  await page.locator('.inspector label.field:has-text("Beschriftung Zurück-Button") input').fill('Zur Übersicht');
  await page.locator('.page-tab', { hasText: 'Startseite' }).click();

  // Autosave: nach Neuladen ist alles da
  await page.waitForSelector('[data-testid=save-state].saved', { timeout: 10000 });
  await page.reload();
  await page.waitForSelector('.editor-stage .plinth-thumbnail');
  assert.equal(await page.locator('.editor-stage .plinth-text').innerText(), 'Herzlich willkommen');
  assert.equal(await page.locator('.editor-stage .plinth-button').count(), 1);

  // Vorschau: Home → Seite 2 → zurück; Home → Video → zurück
  await page.getByRole('button', { name: 'Vorschau' }).click();
  await page.locator('.preview .plinth-button').click();
  await page.waitForSelector('.preview .plinth-button:has-text("Zurück")');
  await page.locator('.preview .plinth-button:has-text("Zurück")').click();
  await page.locator('.preview .plinth-thumbnail').click();
  await page.waitForSelector('.preview video.plinth-video');
  assert.match(await page.locator('.preview .plinth-back').innerText(), /Zur Übersicht/);
  // Nach Videoende automatisch zurück
  await page.waitForSelector('.preview .plinth-thumbnail', { timeout: 15000 });
  await page.keyboard.press('Escape');

  // Veröffentlichen
  await page.getByRole('button', { name: 'Veröffentlichen' }).click();
  await page.getByRole('button', { name: 'Jetzt veröffentlichen' }).click();
  await page.waitForSelector('.steps li.ok:has-text("Revision 1 ist veröffentlicht")', { timeout: 15000 });
  const { revisionen } = await api(page, 'GET', `/projekte/${projekt.id}/revisionen`);
  assert.equal(revisionen[0].nummer, 1);

  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Veröffentlichen mit fehlender Datei ändert nichts und nennt die Datei', { skip: !MEDIA && 'MEDIA_DIR fehlt' }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { page } = await login(ctx);
  await ensureMedia(page);
  const projekt = await freshProject(page);
  // Bild-Element auf eine nicht vorhandene Datei setzen (über die API)
  const draft = await api(page, 'GET', `/projekte/${projekt.id}/entwurf`);
  draft.layout.pages[0].elements.push({ id: 'kaputt', type: 'image', x: 0, y: 0, w: 100, h: 100, image: 'f999999' });
  await api(page, 'PUT', `/projekte/${projekt.id}/entwurf`, { layout: draft.layout, version: draft.version });
  await page.reload();
  await page.waitForSelector('.editor-stage');
  await page.getByRole('button', { name: 'Veröffentlichen' }).click();
  await page.getByRole('button', { name: 'Jetzt veröffentlichen' }).click();
  await page.waitForSelector('.steps li.err');
  assert.match(await page.locator('.problems').innerText(), /f999999/);
  const { revisionen } = await api(page, 'GET', `/projekte/${projekt.id}/revisionen`);
  assert.equal(revisionen.length, 0);
  await ctx.close();
});

test('Konflikt bei gleichzeitiger Bearbeitung in zwei Tabs', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { page } = await login(ctx);
  const projekt = await freshProject(page);
  const other = await ctx.newPage();
  await other.goto(`${BASE}/studio/?projekt=${projekt.id}`);
  await other.waitForSelector('.editor-stage');

  await page.getByRole('button', { name: 'Fläche', exact: true }).click();
  await page.waitForSelector('[data-testid=save-state].saved', { timeout: 10000 });
  await other.getByRole('button', { name: 'Text', exact: true }).click();
  await other.waitForSelector('dialog.dialog:has-text("an anderer Stelle geändert")', { timeout: 10000 });
  await other.getByRole('button', { name: 'Neu laden' }).click();
  await other.waitForSelector('.editor-stage .plinth-shape');
  assert.equal(await other.locator('.editor-stage .plinth-text').count(), 0);
  await ctx.close();
});

test('Upload pausieren und nach Neuladen fortsetzen', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { page } = await login(ctx);
  const dir = mkdtempSync(join(tmpdir(), 'plinth-e2e-'));
  const file = join(dir, `gross-${Date.now()}.mp4`);
  writeFileSync(file, Buffer.alloc(8 * 8 * 1024 * 1024 - 100, 7)); // 8 Teile

  // Speicher-Uploads künstlich verlangsamen und zählen
  const puts = [];
  await ctx.route((u) => u.searchParams.has('partNumber'), async (route) => {
    if (route.request().method() === 'PUT') {
      puts.push(new URL(route.request().url()).searchParams.get('partNumber'));
      await new Promise((r) => setTimeout(r, 1500));
    }
    await route.continue();
  });

  // Erfolgreich abgeschlossene Teile mitschreiben
  const completed = new Set();
  ctx.on('requestfinished', async (req) => {
    const u = new URL(req.url());
    if (req.method() === 'PUT' && u.searchParams.has('partNumber') && (await req.response())?.status() === 200) completed.add(u.searchParams.get('partNumber'));
  });
  await page.setInputFiles('.library input[type=file]', file);
  // Pausieren, sobald die ersten Teile fertig sind (der 4. Teil startet erst danach)
  for (let i = 0; i < 100 && puts.length < 4; i++) await page.waitForTimeout(100);
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.waitForSelector('.job.pausiert');
  const firstRound = new Set(puts);
  const doneBeforePause = new Set(completed);
  assert.ok(doneBeforePause.size >= 1, 'mindestens ein Teil war vor der Pause fertig');

  await page.reload();
  await page.waitForSelector('.pending-item');
  puts.length = 0;
  await page.setInputFiles('.library input[type=file]', file);
  await page.waitForFunction((name) => [...document.querySelectorAll('.lib-name')].some((n) => n.textContent === name), file.split('/').pop(), { timeout: 60000 });
  const { dateien } = await api(page, 'GET', '/dateien');
  const d = dateien.find((x) => x.name === file.split('/').pop());
  assert.equal(d.status, 'fertig');
  assert.ok(puts.length > 0 && puts.length < 8, `nur fehlende Teile erneut hochgeladen (${puts.join(',')} nach ${[...firstRound].join(',')})`);
  for (const n of doneBeforePause) assert.ok(!puts.includes(n), `fertiger Teil ${n} wurde nicht erneut hochgeladen`);
  await api(page, 'DELETE', `/dateien/${d.id}`);
  await ctx.close();
});
