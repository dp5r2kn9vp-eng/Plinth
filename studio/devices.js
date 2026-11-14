// Geräte-Übersicht: Kundencode, Status, geladene Revision, umbenennen, sperren, entfernen, Projekt zuordnen.

import { get, patch, post, del } from './lib/api.js';
import { h, toast, dialog } from './lib/dom.js';

const ONLINE_MS = 3 * 60 * 1000;

function relative(iso) {
  if (!iso) return 'nie';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'gerade eben';
  if (s < 3600) return `vor ${Math.round(s / 60)} min`;
  if (s < 86400) return `vor ${Math.round(s / 3600)} h`;
  return new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
}

export async function renderDevices(container) {
  const [{ kunde }, { geraete }, { projekte }] = await Promise.all([get('/kunde'), get('/geraete'), get('/projekte')]);
  const projektName = (id) => projekte.find((p) => p.id === id)?.name;
  const defaultProjekt = projekte[0];
  const reload = () => renderDevices(container);

  const codeBox = h('div.code-box', {},
    h('div', {},
      h('div.muted.small', {}, 'Kundencode für neue Player'),
      h('div.code', { 'data-testid': 'kundencode' }, kunde.kundencode)),
    h('div.btn-row', {},
      h('button.btn.sm', { type: 'button', onclick: async () => {
        await navigator.clipboard?.writeText(kunde.kundencode).catch(() => {});
        toast('Kundencode kopiert.', 'ok');
      } }, 'Kopieren'),
      h('button.btn.sm', { type: 'button', onclick: async () => {
        const ok = await dialog('Neuen Kundencode erzeugen?', h('p', {}, 'Der bisherige Code funktioniert danach nicht mehr für neue Geräte. Bereits eingerichtete Player bleiben verbunden.'), { ok: 'Neu erzeugen' });
        if (ok) {
          await post('/kunde/kundencode');
          reload();
        }
      } }, 'Neu erzeugen')));

  const rows = geraete.map((g) => {
    const online = g.zuletztGesehenAm && Date.now() - Date.parse(g.zuletztGesehenAm) < ONLINE_MS;
    const projekt = projekte.find((p) => p.id === (g.projektId ?? defaultProjekt?.id));
    const aktuell = projekt?.revision ?? null;
    const stand = g.geladeneRevision == null ? '–' : `Rev. ${g.geladeneRevision}`;
    const veraltet = aktuell !== null && g.geladeneRevision !== aktuell;
    return h(`tr${g.gesperrt ? '.blocked' : ''}`, {},
      h('td', {}, h(`span.dot.${g.gesperrt ? 'off' : online ? 'on' : 'idle'}`, { title: g.gesperrt ? 'gesperrt' : online ? 'online' : 'offline' }), g.name),
      h('td', {}, g.gesperrt ? 'gesperrt' : online ? 'online' : `offline (${relative(g.zuletztGesehenAm)})`),
      h('td', {}, h('span', { class: veraltet ? 'warn' : '' }, stand), aktuell !== null ? h('span.muted.small', {}, ` / aktuell ${aktuell}`) : null),
      h('td', {}, h('select', { onchange: async (e) => {
        await patch(`/geraete/${g.id}`, { projektId: e.target.value ? Number(e.target.value) : null });
        reload();
      } },
      h('option', { value: '', selected: g.projektId == null }, `Standard (${defaultProjekt?.name ?? '–'})`),
      projekte.map((p) => h('option', { value: p.id, selected: g.projektId === p.id }, p.name)))),
      h('td.muted.small', {}, g.appVersion ?? ''),
      h('td.actions', {},
        h('button.btn.sm', { type: 'button', onclick: async () => {
          const name = prompt('Neuer Name', g.name);
          if (name?.trim()) {
            await patch(`/geraete/${g.id}`, { name: name.trim() });
            reload();
          }
        } }, 'Umbenennen'),
        h('button.btn.sm', { type: 'button', onclick: async () => {
          await patch(`/geraete/${g.id}`, { gesperrt: !g.gesperrt });
          reload();
        } }, g.gesperrt ? 'Entsperren' : 'Sperren'),
        h('button.btn.sm.danger', { type: 'button', onclick: async () => {
          const ok = await dialog(`„${g.name}“ entfernen?`, h('p', {}, 'Der Player verliert sofort den Zugang und muss mit dem Kundencode neu eingerichtet werden.'), { ok: 'Entfernen', danger: true });
          if (ok) {
            await del(`/geraete/${g.id}`);
            reload();
          }
        } }, 'Entfernen')));
  });

  container.replaceChildren(h('div.devices', {},
    h('h1', {}, 'Geräte'),
    codeBox,
    geraete.length
      ? h('table.table', {}, h('thead', {}, h('tr', {}, ['Name', 'Status', 'Stand', 'Projekt', 'Version', ''].map((t) => h('th', {}, t)))), h('tbody', {}, rows))
      : h('p.muted', {}, 'Noch keine Player eingerichtet. Beim ersten Start fragt der Player nach dem Kundencode oben.'),
    h('p.muted.small', {}, `Online = Kontakt in den letzten 3 Minuten. ${projektName(defaultProjekt?.id) ? `Ohne Zuordnung zeigen Geräte „${defaultProjekt.name}“.` : ''}`)));
}
