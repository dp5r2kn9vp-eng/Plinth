'use strict';
// Wartungsmodus: Flag-Datei, die der Watchdog liest. Endet nach Ablauf oder beim nächsten Windows-Start.
// PIN-Sperre: nach 5 Fehlversuchen 5 Minuten, danach jeweils doppelt so lange (max. 1 h).
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { readJson, writeJson } = require('./fsutil');

const MAX_FAILS = 5;
const BASE_LOCK_MS = 5 * 60 * 1000;
const MAX_LOCK_MS = 60 * 60 * 1000;

/** Startzeitpunkt des Betriebssystems (auf die Minute genau stabil). */
function bootTime(now = Date.now(), uptimeSec = os.uptime()) {
  return now - uptimeSec * 1000;
}

class Maintenance {
  constructor(dir, { now = () => Date.now(), boot = () => bootTime() } = {}) {
    this.flagFile = path.join(dir, 'maintenance.json');
    this.lockFile = path.join(dir, 'pin-lock.json');
    this.now = now;
    this.boot = boot;
  }

  /** @param {'quit'|'timed'} mode  quit = bis zum nächsten Start von Windows (oder manuellem Start) */
  enter(mode, minutes = 0) {
    writeJson(this.flagFile, { mode, until: mode === 'timed' ? this.now() + minutes * 60000 : null, bootTime: this.boot() });
  }

  clear() {
    fs.rmSync(this.flagFile, { force: true });
  }

  /** @returns {{active:boolean, until:number|null}} */
  state() {
    const f = readJson(this.flagFile);
    if (!f) return { active: false, until: null };
    const sameBoot = Math.abs(f.bootTime - this.boot()) < 2 * 60 * 1000;
    const expired = f.mode === 'timed' && f.until <= this.now();
    if (!sameBoot || expired) {
      this.clear();
      return { active: false, until: null };
    }
    return { active: true, until: f.until };
  }

  // ---------- PIN-Sperre ----------

  lockState() {
    return readJson(this.lockFile, { fails: 0, lockedUntil: 0, locks: 0 });
  }

  isLocked() {
    return this.lockState().lockedUntil > this.now();
  }

  /**
   * Prüft eine PIN mit Sperre. Verrät nicht, ob gesperrt oder falsch (beides: false).
   * @param {(pin:string)=>boolean} check
   * @returns {'ok'|'fail'}
   */
  tryPin(pin, check) {
    const s = this.lockState();
    if (s.lockedUntil > this.now()) return 'fail';
    if (check(pin)) {
      writeJson(this.lockFile, { fails: 0, lockedUntil: 0, locks: 0 });
      return 'ok';
    }
    s.fails += 1;
    if (s.fails >= MAX_FAILS) {
      s.lockedUntil = this.now() + Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** s.locks);
      s.locks += 1;
      s.fails = 0;
    }
    writeJson(this.lockFile, s);
    return 'fail';
  }
}

module.exports = { Maintenance, bootTime, MAX_FAILS, BASE_LOCK_MS };
