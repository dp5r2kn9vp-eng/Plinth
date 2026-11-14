'use strict';
// Hilfen für Integrationstests gegen eine laufende Plinth-Installation (PLINTH_URL).
const crypto = require('node:crypto');

const BASE = process.env.PLINTH_URL;
const EMAIL = process.env.PLINTH_EMAIL ?? 'praxis@plinth.test';
const PASSWORD = process.env.PLINTH_PASSWORD ?? 'Demo-Passwort-2026';

class Studio {
  constructor() {
    this.cookie = '';
  }

  async call(method, p, body) {
    const res = await fetch(`${BASE}/api/v1${p}`, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), Cookie: this.cookie },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    if (res.status === 204) return null;
    const data = await res.json();
    if (!res.ok) throw new Error(`${method} ${p}: ${res.status} ${JSON.stringify(data)}`);
    return data;
  }

  login() {
    return this.call('POST', '/auth/login', { email: EMAIL, password: PASSWORD });
  }

  async upload(name, mime, data) {
    const info = await this.call('POST', '/uploads', { name, mime, groesse: data.length });
    const id = info.datei.id;
    const size = info.upload.teilGroesse;
    const teile = [];
    for (let n = 1; n <= info.upload.teileAnzahl; n++) {
      const chunk = data.subarray((n - 1) * size, n * size);
      const { urls } = await this.call('POST', `/uploads/${id}/teile`, { teile: [n] });
      const res = await fetch(urls[n], { method: 'PUT', body: chunk });
      teile.push({ nummer: n, etag: res.headers.get('etag') });
    }
    return (await this.call('POST', `/uploads/${id}/abschliessen`, { teile, sha256: crypto.createHash('sha256').update(data).digest('hex') })).datei;
  }

  async project(name) {
    return (await this.call('POST', '/projekte', { name, ausrichtung: 'landscape' })).projekt;
  }

  async publish(projektId, mutate) {
    const draft = await this.call('GET', `/projekte/${projektId}/entwurf`);
    mutate(draft.layout);
    await this.call('PUT', `/projekte/${projektId}/entwurf`, { layout: draft.layout, version: draft.version });
    return (await this.call('POST', `/projekte/${projektId}/veroeffentlichen`, {})).revision;
  }

  async registerDevice(name) {
    const { kunde } = await this.call('GET', '/kunde');
    const res = await fetch(`${BASE}/api/v1/player/registrieren`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kundencode: kunde.kundencode, name, appVersion: 'test' }),
    });
    const data = await res.json();
    if (res.status !== 201) {
      throw new Error(`Registrierung fehlgeschlagen (${res.status}): ${data.error?.message}${res.status === 429 ? ' – Rate-Limit der API, kurz warten oder rate_limits leeren' : ''}`);
    }
    return data;
  }
}

module.exports = { Studio, BASE };
