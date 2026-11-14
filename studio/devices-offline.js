// Geräte im Offline-Betrieb (Plinth Studio Desktop): Player im lokalen Netz finden, koppeln, Projekt zuordnen,
// Wartungs-PIN für alle Player festlegen.

import { get, post, put, patch, del } from './lib/api.js';
import { h, toast, dialog } from './lib/dom.js';

const PLATTFORM = { windows: 'Windows', android: 'Android', linux: 'Linux', darwin: 'macOS' };

export async function renderOfflineDevices(container) {
  container.replaceChildren(h('div.devices', {}, h('h1', {}, 'Geräte'), h('p.muted', {}, 'Suche Player im Netzwerk …')));
  const [data, { projekte }] = await Promise.all([get('/offline/player'), get('/projekte')]);
  const reload = () => renderOfflineDevices(container);
  const first = projekte[0];

  const pairDialog = async ({ host = '', port = '', name = '' } = {}) => {
    const hostIn = h('input', { name: 'host', value: host, placeholder: 'z. B. 192.168.1.40', required: true, spellcheck: false });
    const codeIn = h('input', { name: 'code', inputMode: 'numeric', maxLength: 7, placeholder: '123 456', required: true, autocomplete: 'off' });
    const nameIn = h('input', { name: 'name', value: name, maxLength: 100, placeholder: 'z. B. Foyer links' });
    const res = await dialog('Player koppeln', h('div', {},
      h('p.small', {}, 'Der Kopplungscode steht groß auf dem Bildschirm des Players (oder im Wartungsmenü unter „Kopplungscode anzeigen“).'),
      h('label.field', {}, h('span', {}, 'Adresse des Players'), hostIn),
      h('label.field', {}, h('span', {}, 'Kopplungscode'), codeIn),
      h('label.field', {}, h('span', {}, 'Name (optional)'), nameIn)), {
      ok: 'Koppeln',
      onOk: async () => (await post('/offline/player', { host: hostIn.value.trim(), port: Number(port) || undefined, code: codeIn.value, name: nameIn.value.trim() || undefined })).player,
    });
    if (res) {
      toast(`„${res.name}“ ist gekoppelt.`, 'ok');
      reload();
    }
  };

  const rows = data.player.map((p) => {
    const projekt = projekte.find((x) => x.id === (p.projektId ?? first?.id));
    const aktuell = projekt?.revision ?? null;
    const stand = p.stand ? `${p.stand.name ?? 'Projekt'} · Rev. ${p.stand.revision}` : '–';
    const veraltet = aktuell !== null && (!p.stand || p.stand.id !== projekt.id || p.stand.revision !== aktuell);
    return h('tr', {},
      h('td', {}, h(`span.dot.${p.online ? 'on' : 'idle'}`, { title: p.online ? 'erreichbar' : 'nicht erreichbar' }), p.name),
      h('td', {}, p.online ? `erreichbar (${p.host})` : `nicht erreichbar${p.zuletztGesehenAm ? ` · zuletzt ${new Date(p.zuletztGesehenAm).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}` : ''}`),
      h('td', {}, h('span', { class: veraltet ? 'warn' : '' }, stand)),
      h('td', {}, h('select', { onchange: async (e) => {
        await patch(`/offline/player/${p.id}`, { projektId: e.target.value ? Number(e.target.value) : null });
        reload();
      } },
      h('option', { value: '', selected: p.projektId == null }, `Standard (${first?.name ?? '–'})`),
      projekte.map((x) => h('option', { value: x.id, selected: p.projektId === x.id }, x.name)))),
      h('td.muted.small', {}, [PLATTFORM[p.plattform] ?? p.plattform, p.version].filter(Boolean).join(' · ')),
      h('td.actions', {},
        h('button.btn.sm', { type: 'button', disabled: !p.online || !projekt?.revision, title: 'Aktuellen Stand jetzt an diesen Player senden', onclick: () => sendTo(projekt, p) }, 'Senden'),
        h('button.btn.sm', { type: 'button', onclick: async () => {
          const name = prompt('Neuer Name', p.name);
          if (name?.trim()) {
            await patch(`/offline/player/${p.id}`, { name: name.trim() });
            reload();
          }
        } }, 'Umbenennen'),
        h('button.btn.sm.danger', { type: 'button', onclick: async () => {
          const ok = await dialog(`„${p.name}“ entfernen?`, h('p', {}, 'Der Player zeigt weiter seinen letzten Stand. Um ihn wieder zu beliefern, muss er erneut gekoppelt werden.'), { ok: 'Entfernen', danger: true });
          if (ok) {
            await del(`/offline/player/${p.id}`);
            reload();
          }
        } }, 'Entfernen')));
  });

  const found = data.gefunden.map((f) => h('div.found-item', {},
    h('div', {}, h('strong', {}, f.name), h('span.muted.small', {}, ` · ${f.host} · ${PLATTFORM[f.plattform] ?? f.plattform ?? ''}${f.gekoppelt ? ' · mit anderem Studio gekoppelt' : ''}`)),
    h('button.btn.sm.primary', { type: 'button', onclick: () => pairDialog({ host: f.host, port: f.port, name: f.name }) }, 'Koppeln')));

  const pinBox = h('div.code-box', {},
    h('div', {},
      h('div.muted.small', {}, 'Wartungs-PIN für alle Player'),
      h('div', {}, data.einstellungen.pinGesetzt ? 'festgelegt' : h('span.warn', {}, 'noch nicht festgelegt – bis dahin gilt der Kopplungscode des Players als PIN'))),
    h('button.btn.sm', { type: 'button', onclick: async () => {
      const pin = h('input', { type: 'password', inputMode: 'numeric', pattern: '\\d{4,8}', maxLength: 8, required: true });
      const pin2 = h('input', { type: 'password', inputMode: 'numeric', pattern: '\\d{4,8}', maxLength: 8, required: true });
      const res = await dialog('Wartungs-PIN festlegen', h('div', {},
        h('p.small', {}, 'Mit der PIN öffnet man am Player das Wartungsmenü (Strg + Alt + Umschalt + K oder 5× oben links tippen).'),
        h('label.field', {}, h('span', {}, 'PIN (4–8 Ziffern)'), pin),
        h('label.field', {}, h('span', {}, 'PIN wiederholen'), pin2)), {
        ok: 'Speichern',
        onOk: async () => {
          if (pin.value !== pin2.value) throw new Error('Die PINs stimmen nicht überein.');
          return put('/offline/einstellungen', { pin: pin.value });
        },
      });
      if (res) {
        toast(res.gesamt === res.uebertragen ? 'PIN gespeichert und an alle Player übertragen.' : `PIN gespeichert. ${res.gesamt - res.uebertragen} Player nicht erreichbar – sie erhalten die PIN beim nächsten Senden.`, 'ok', 6000);
        reload();
      }
    } }, data.einstellungen.pinGesetzt ? 'Ändern' : 'Festlegen'));

  container.replaceChildren(h('div.devices', {},
    h('div.devices-head', {}, h('h1', {}, 'Geräte'),
      h('div.btn-row', {},
        h('button.btn.sm', { type: 'button', onclick: reload }, 'Neu suchen'),
        h('button.btn.sm.primary', { type: 'button', onclick: () => pairDialog() }, 'Player per Adresse koppeln'))),
    pinBox,
    data.player.length
      ? h('table.table', {}, h('thead', {}, h('tr', {}, ['Name', 'Status', 'Stand', 'Projekt', 'System', ''].map((t) => h('th', {}, t)))), h('tbody', {}, rows))
      : h('p.muted', {}, 'Noch keine Player gekoppelt.'),
    h('h2.section', {}, 'Im Netzwerk gefunden'),
    found.length ? h('div.found', {}, found) : h('p.muted.small', {}, 'Keine weiteren Player gefunden. Player und dieser Computer müssen im selben Netzwerk sein. Ohne Fund: „Player per Adresse koppeln“ – die Adresse steht auf dem Bildschirm des Players.'),
    h('p.muted.small', {}, `Player ohne Zuordnung zeigen „${first?.name ?? 'das erste Projekt'}“. Veröffentlichen sendet den neuen Stand an alle Player des Projekts.`)));
}

/** Aktuellen Stand eines Projekts an einen Player senden (mit Fortschritt). */
async function sendTo(projekt, player) {
  const { verteilung } = await post('/offline/verteilen', { projektId: projekt.id, playerIds: [player.id] });
  const { distributionView } = await import('./editor/publish.js');
  const dlg = h('dialog.dialog', {}, h('h2', {}, `An „${player.name}“ senden`));
  document.body.appendChild(dlg);
  dlg.showModal();
  await distributionView(dlg, verteilung);
}
