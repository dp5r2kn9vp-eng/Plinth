'use strict';
// Watchdog: startet den Player, startet ihn nach Absturz oder Hänger neu.
// - Hänger: der Player schreibt alle 10 s "HB" auf stdout; bleibt das 60 s aus, wird er beendet
// - Absturzschleife: mehr als 5 Abstürze in 2 Minuten → 30 s Pause statt 2 s
// - Wartungsmodus (maintenance.json): kein Neustart, bis er abläuft oder Windows neu startet
const { EventEmitter } = require('node:events');

const FAST_DELAY = 2000;
const SLOW_DELAY = 30000;
const CRASH_WINDOW = 2 * 60 * 1000;
const CRASH_LIMIT = 5;

class Watchdog extends EventEmitter {
  /**
   * @param {object} o
   * @param {() => import('node:child_process').ChildProcess} o.spawn
   * @param {{state:()=>{active:boolean,until:number|null}, clear:()=>void}} o.maintenance
   * @param {{info:Function,warn:Function,error:Function}} o.log
   * @param {() => number} [o.now]
   * @param {number} [o.heartbeatTimeoutMs]
   * @param {number} [o.checkMs]
   */
  constructor(o) {
    super();
    this.o = { now: () => Date.now(), heartbeatTimeoutMs: 60000, checkMs: 5000, ...o };
    this.child = null;
    this.crashes = [];
    this.timer = null;
    this.stopped = false;
  }

  start() {
    this.stopped = false;
    this.next(0);
    this.hbTimer = setInterval(() => this.checkHeartbeat(), this.o.checkMs);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.hbTimer);
    this.child?.kill();
  }

  next(delay) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.launch(), delay);
  }

  launch() {
    if (this.stopped || this.child) return;
    const m = this.o.maintenance.state();
    if (m.active) {
      // bis zum Ablauf warten (bei "Beenden": regelmäßig prüfen, ob Windows neu gestartet wurde oder jemand den Player startet)
      const wait = m.until ? Math.max(1000, m.until - this.o.now() + 500) : 30000;
      this.emit('waiting', m);
      this.next(Math.min(wait, 30000));
      return;
    }
    this.o.log.info('Watchdog startet Player');
    const child = this.o.spawn();
    this.child = child;
    this.lastBeat = this.o.now();
    this.emit('spawn', child);
    child.stdout?.on('data', (d) => {
      if (String(d).includes('HB')) this.lastBeat = this.o.now();
    });
    child.on('exit', (code, signal) => this.onExit(child, code, signal));
  }

  onExit(child, code, signal) {
    if (this.child !== child) return;
    this.child = null;
    if (this.stopped) return;
    const now = this.o.now();
    const m = this.o.maintenance.state();
    if (m.active) {
      this.o.log.info('Player im Wartungsmodus beendet – kein Neustart', { until: m.until });
      this.next(0);
      return;
    }
    this.crashes = this.crashes.filter((t) => now - t < CRASH_WINDOW);
    this.crashes.push(now);
    const delay = this.crashes.length > CRASH_LIMIT ? SLOW_DELAY : FAST_DELAY;
    this.o.log.warn('Player beendet – Neustart', { code, signal, delayMs: delay, crashesIn2Min: this.crashes.length });
    this.emit('restart', { code, signal, delay });
    this.next(delay);
  }

  checkHeartbeat() {
    if (!this.child) return;
    if (this.o.now() - this.lastBeat > this.o.heartbeatTimeoutMs) {
      this.o.log.error('Player reagiert nicht (kein Heartbeat) – wird beendet');
      this.emit('hang');
      this.lastBeat = this.o.now();
      this.child.kill('SIGKILL');
    }
  }

  /** Jemand startet Plinth manuell (z. B. Startmenü), während der Watchdog wartet: Wartung beenden. */
  wake() {
    this.o.maintenance.clear();
    if (!this.child) this.next(0);
  }
}

module.exports = { Watchdog, FAST_DELAY, SLOW_DELAY, CRASH_LIMIT };
