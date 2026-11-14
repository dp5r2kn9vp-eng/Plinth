'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Config } = require('../src/config');
const { Maintenance, MAX_FAILS, BASE_LOCK_MS } = require('../src/maintenance');
const { Logger, MAX_BYTES } = require('../src/logger');
const { writeAtomic } = require('../src/fsutil');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'plinth-unit-'));
const fakeCipher = (available = true) => ({
  available: () => available,
  encrypt: (s) => Buffer.from([...Buffer.from(s)].map((b) => b ^ 0x5a)),
  decrypt: (b) => Buffer.from([...b].map((x) => x ^ 0x5a)).toString(),
});

test('Token wird verschlüsselt gespeichert und gelesen', () => {
  const dir = tmp();
  const c = new Config(dir, fakeCipher());
  c.token = 'geheimes-token-123';
  const raw = fs.readFileSync(path.join(dir, 'config.json'), 'utf8');
  assert.ok(!raw.includes('geheimes-token-123'));
  assert.equal(JSON.parse(raw).token.enc, 'safeStorage');
  assert.equal(new Config(dir, fakeCipher()).token, 'geheimes-token-123');
});

test('Nicht entschlüsselbares Token gilt als nicht vorhanden', () => {
  const dir = tmp();
  const c = new Config(dir, fakeCipher());
  c.token = 'x';
  const broken = { ...fakeCipher(), decrypt: () => { throw new Error('anderer Benutzer'); } };
  assert.equal(new Config(dir, broken).token, null);
});

test('PIN nur als Hash, Prüfung korrekt', () => {
  const dir = tmp();
  const c = new Config(dir, fakeCipher());
  c.setPin('4711');
  assert.ok(!fs.readFileSync(path.join(dir, 'config.json'), 'utf8').includes('4711'));
  assert.equal(c.checkPin('4711'), true);
  assert.equal(c.checkPin('4712'), false);
});

test('Wartung zeitgesteuert: aktiv bis Ablauf', () => {
  let now = 1_000_000;
  const m = new Maintenance(tmp(), { now: () => now, boot: () => 500 });
  m.enter('timed', 30);
  assert.equal(m.state().active, true);
  now += 29 * 60000;
  assert.equal(m.state().active, true);
  now += 2 * 60000;
  assert.equal(m.state().active, false);
});

test('Wartung "Beenden" endet beim nächsten Windows-Start', () => {
  let boot = 500;
  const dir = tmp();
  const m = new Maintenance(dir, { now: () => 10_000_000, boot: () => boot });
  m.enter('quit');
  assert.equal(m.state().active, true);
  boot += 10 * 60000; // Neustart
  assert.equal(m.state().active, false);
  assert.equal(fs.existsSync(path.join(dir, 'maintenance.json')), false);
});

test('PIN-Sperre nach Fehlversuchen, auch die richtige PIN wird dann abgelehnt', () => {
  let now = 0;
  const m = new Maintenance(tmp(), { now: () => now, boot: () => 0 });
  const check = (p) => p === '1234';
  for (let i = 0; i < MAX_FAILS; i++) assert.equal(m.tryPin('0000', check), 'fail');
  assert.equal(m.isLocked(), true);
  assert.equal(m.tryPin('1234', check), 'fail');
  // Weitere Fehlversuche direkt nach der Sperre: zweite Sperre dauert doppelt so lange
  now += BASE_LOCK_MS + 1;
  for (let i = 0; i < MAX_FAILS; i++) m.tryPin('0000', check);
  now += BASE_LOCK_MS + 1;
  assert.equal(m.isLocked(), true);
  now += BASE_LOCK_MS;
  assert.equal(m.isLocked(), false);
  // Richtige PIN setzt alles zurück
  assert.equal(m.tryPin('1234', check), 'ok');
  assert.equal(m.lockState().locks, 0);
});

test('Log rotiert bei 5 MB', () => {
  const dir = tmp();
  const log = new Logger(dir);
  fs.writeFileSync(path.join(dir, 'player.log'), Buffer.alloc(MAX_BYTES, 'x'));
  log.info('nach Rotation');
  assert.ok(fs.existsSync(path.join(dir, 'player.1.log')));
  assert.match(fs.readFileSync(path.join(dir, 'player.log'), 'utf8'), /nach Rotation/);
  assert.equal(log.recent.length, 1);
});

test('Atomares Schreiben hinterlässt keine Temp-Dateien', () => {
  const dir = tmp();
  writeAtomic(path.join(dir, 'a.json'), '{}');
  assert.deepEqual(fs.readdirSync(dir), ['a.json']);
});
