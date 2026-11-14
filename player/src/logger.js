'use strict';
// Logdatei mit Rotation: logs/player.log, bei 5 MB → player.1.log … player.4.log.
const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 5 * 1024 * 1024;
const KEEP = 4;

class Logger {
  constructor(dir, { echo = false } = {}) {
    this.dir = dir;
    this.file = path.join(dir, 'player.log');
    this.echo = echo;
    this.recent = []; // letzte Meldungen für die Techniker-Anzeige
    fs.mkdirSync(dir, { recursive: true });
  }

  rotate() {
    try {
      if (fs.statSync(this.file).size < MAX_BYTES) return;
    } catch {
      return;
    }
    for (let i = KEEP; i >= 1; i--) {
      const from = i === 1 ? this.file : path.join(this.dir, `player.${i - 1}.log`);
      const to = path.join(this.dir, `player.${i}.log`);
      try {
        fs.renameSync(from, to);
      } catch {
        // Datei gibt es noch nicht
      }
    }
  }

  write(level, msg, data) {
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${msg}${data ? ` ${JSON.stringify(data)}` : ''}`;
    this.recent.push(line);
    if (this.recent.length > 200) this.recent.shift();
    try {
      this.rotate();
      fs.appendFileSync(this.file, `${line}\n`);
    } catch {
      // Logging darf den Player nie stoppen
    }
    if (this.echo) console.error(line);
  }

  info(msg, data) { this.write('info', msg, data); }
  warn(msg, data) { this.write('warn', msg, data); }
  error(msg, data) { this.write('error', msg, data); }
}

module.exports = { Logger, MAX_BYTES };
