'use strict';
// Studio-Server ohne Electron starten (Entwicklung, Browser-Tests): node scripts/dev-server.js [port] [datenordner]
const path = require('node:path');
const os = require('node:os');
const { createStudioServer } = require('../src/server');

const port = Number(process.argv[2]) || 8098;
const dataDir = process.argv[3] || path.join(os.tmpdir(), 'plinth-studio-dev');
const root = path.join(__dirname, '..', '..');
const s = createStudioServer({ dataDir, studioDir: path.join(root, 'studio'), sharedDir: path.join(root, 'shared'), version: 'dev', log: { error: console.error } });
s.listen(port).then((p) => console.log(`Plinth Studio (offline): http://127.0.0.1:${p}/studio/  Daten: ${dataDir}`));
