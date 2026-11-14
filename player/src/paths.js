'use strict';
// Datenordner des Players. Windows: %ProgramData%\Plinth (für alle Benutzer, auch beim Auto-Login-Konto).
const os = require('node:os');
const path = require('node:path');

function dataDir() {
  if (process.env.PLINTH_DATA_DIR) return process.env.PLINTH_DATA_DIR;
  if (process.platform === 'win32') return path.join(process.env.ProgramData || 'C:\\ProgramData', 'Plinth');
  return path.join(os.homedir(), '.local', 'share', 'plinth');
}

module.exports = { dataDir };
