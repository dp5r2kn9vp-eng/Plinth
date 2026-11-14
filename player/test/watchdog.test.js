'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { Watchdog, FAST_DELAY, SLOW_DELAY, CRASH_LIMIT } = require('../src/watchdog');

const log = { info() {}, warn() {}, error() {} };

function fakeChild() {
  const c = new EventEmitter();
  c.stdout = new PassThrough();
  c.killed = null;
  c.kill = (sig = 'SIGTERM') => {
    c.killed = sig;
    setImmediate(() => c.emit('exit', null, sig));
  };
  return c;
}

function setup(t, maintenance = { state: () => ({ active: false, until: null }), clear() {} }, extra = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const children = [];
  const wd = new Watchdog({ spawn: () => { const c = fakeChild(); children.push(c); return c; }, maintenance, log, now: () => Date.now(), ...extra });
  wd.start();
  t.mock.timers.tick(0);
  return { wd, children };
}

test('startet den Player und nach Absturz nach 2 s neu', (t) => {
  const { wd, children } = setup(t);
  assert.equal(children.length, 1);
  children[0].emit('exit', 1, null);
  t.mock.timers.tick(FAST_DELAY - 1);
  assert.equal(children.length, 1);
  t.mock.timers.tick(1);
  assert.equal(children.length, 2);
  wd.stop();
});

test('Absturzschleife: danach 30 s Pause', (t) => {
  const { wd, children } = setup(t);
  for (let i = 0; i < CRASH_LIMIT; i++) {
    children.at(-1).emit('exit', 1, null);
    t.mock.timers.tick(FAST_DELAY);
  }
  const before = children.length;
  children.at(-1).emit('exit', 1, null);
  t.mock.timers.tick(FAST_DELAY);
  assert.equal(children.length, before, 'noch kein Neustart');
  t.mock.timers.tick(SLOW_DELAY);
  assert.equal(children.length, before + 1);
  wd.stop();
});

test('Hänger ohne Heartbeat wird beendet und neu gestartet', (t) => {
  const { wd, children } = setup(t, undefined, { heartbeatTimeoutMs: 60000, checkMs: 5000 });
  children[0].stdout.write('HB\n');
  t.mock.timers.tick(55000);
  assert.equal(children[0].killed, null);
  t.mock.timers.tick(10000);
  assert.equal(children[0].killed, 'SIGKILL');
  wd.stop();
});

test('Wartungsmodus: kein Neustart bis zum Ablauf', (t) => {
  let until = null;
  const maintenance = { state: () => (until && Date.now() < until ? { active: true, until } : { active: false, until: null }), clear() { until = null; } };
  const { wd, children } = setup(t, maintenance);
  until = Date.now() + 10 * 60000;
  children[0].emit('exit', 0, null);
  t.mock.timers.tick(5 * 60000);
  assert.equal(children.length, 1);
  t.mock.timers.tick(6 * 60000);
  assert.equal(children.length, 2, 'nach Ablauf wieder gestartet');
  wd.stop();
});

test('Manueller Start beendet die Wartung sofort', (t) => {
  let active = false;
  const maintenance = { state: () => ({ active, until: null }), clear() { active = false; } };
  const { wd, children } = setup(t, maintenance);
  active = true;
  children[0].emit('exit', 0, null);
  t.mock.timers.tick(60000);
  assert.equal(children.length, 1);
  wd.wake();
  t.mock.timers.tick(0);
  assert.equal(children.length, 2);
  wd.stop();
});
