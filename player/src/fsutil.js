'use strict';
const fs = require('node:fs');
const path = require('node:path');

/** Schreibt eine Datei atomar: erst temporär, dann umbenennen. Ein Stromausfall hinterlässt nie eine halbe Datei. */
function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  writeAtomic(file, JSON.stringify(value, null, 2));
}

module.exports = { writeAtomic, readJson, writeJson };
