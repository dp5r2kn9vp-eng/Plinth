'use strict';
// Lokale Datenablage von Plinth Studio Desktop: eine JSON-Datei (atomar geschrieben) plus Medienordner.
// Mengen sind klein (Projekte, Entwürfe, Revisionen, Dateiliste, Player) – eine Datenbank wäre Überbau.
const fs = require('node:fs');
const path = require('node:path');

const EMPTY = () => ({
  format: 1,
  naechsteId: { projekt: 1, datei: 1, player: 1 },
  projekte: [],
  entwuerfe: {}, // projektId → { layout, version, aktualisiertAm }
  revisionen: {}, // projektId → [{ nummer, manifest, veroeffentlichtAm }]
  dateien: [],
  player: [],
  einstellungen: { pin: null, studioId: null },
});

class Db {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'studio.json');
    fs.mkdirSync(dir, { recursive: true });
    try {
      this.data = { ...EMPTY(), ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    } catch (e) {
      if (fs.existsSync(this.file)) {
        // Beschädigt: sichern statt überschreiben
        fs.copyFileSync(this.file, `${this.file}.defekt-${Date.now()}`);
      }
      this.data = EMPTY();
    }
  }

  nextId(kind) {
    const id = this.data.naechsteId[kind]++;
    return id;
  }

  save() {
    const tmp = `${this.file}.${process.pid}.tmp`;
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, JSON.stringify(this.data));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Db };
