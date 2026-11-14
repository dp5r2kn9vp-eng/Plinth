'use strict';
// Gerätekonfiguration in <Datenordner>/config.json.
// Das Gerätetoken wird verschlüsselt abgelegt (Electron safeStorage = DPAPI unter Windows),
// die Wartungs-PIN nur als scrypt-Hash.
const crypto = require('node:crypto');
const path = require('node:path');
const { readJson, writeJson } = require('./fsutil');

const DEFAULTS = {
  apiUrl: 'https://plinth.klangniveau.de/api',
  pollSeconds: 45,
  hideCursor: true,
  deviceName: null,
  token: null, // { enc: 'safeStorage'|'plain', value: base64 }
  pin: null, // { salt, hash }
};

class Config {
  /**
   * @param {string} dir Datenordner
   * @param {{encrypt:(s:string)=>Buffer, decrypt:(b:Buffer)=>string, available:()=>boolean}} cipher
   */
  constructor(dir, cipher) {
    this.file = path.join(dir, 'config.json');
    this.cipher = cipher;
    this.data = { ...DEFAULTS, ...readJson(this.file, {}) };
    if (process.env.PLINTH_API_URL) this.data.apiUrl = process.env.PLINTH_API_URL;
  }

  save() {
    writeJson(this.file, this.data);
  }

  get(key) {
    return this.data[key];
  }

  set(values) {
    Object.assign(this.data, values);
    this.save();
  }

  get token() {
    const t = this.data.token;
    if (!t) return null;
    try {
      return t.enc === 'safeStorage' ? this.cipher.decrypt(Buffer.from(t.value, 'base64')) : Buffer.from(t.value, 'base64').toString('utf8');
    } catch {
      return null; // z. B. anderes Windows-Konto: Token nicht lesbar → neu einrichten
    }
  }

  set token(value) {
    if (value === null) {
      this.data.token = null;
    } else if (this.cipher.available()) {
      this.data.token = { enc: 'safeStorage', value: this.cipher.encrypt(value).toString('base64') };
    } else {
      this.data.token = { enc: 'plain', value: Buffer.from(value, 'utf8').toString('base64') };
    }
    this.save();
  }

  setPin(pin) {
    const salt = crypto.randomBytes(16);
    this.data.pin = { salt: salt.toString('base64'), hash: crypto.scryptSync(pin, salt, 32).toString('base64') };
    this.save();
  }

  checkPin(pin) {
    const p = this.data.pin;
    if (!p) return false;
    const hash = crypto.scryptSync(String(pin), Buffer.from(p.salt, 'base64'), 32);
    return crypto.timingSafeEqual(hash, Buffer.from(p.hash, 'base64'));
  }
}

module.exports = { Config, DEFAULTS };
