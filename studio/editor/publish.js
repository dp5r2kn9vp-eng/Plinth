// Veröffentlichen: speichert, prüft und erzeugt eine neue Revision. Fehler zeigen genau, was fehlt.

import { get, post } from '../lib/api.js';
import { h, dialog, formatBytes } from '../lib/dom.js';
import { mode } from '../lib/mode.js';

const PHASE = { warten: 'wartet', pruefen: 'prüft', uebertragen: 'überträgt', umschalten: 'schaltet um', fertig: 'läuft mit neuem Stand', fehler: 'Fehler' };

/** Fortschritt einer Verteilung an Player im lokalen Netz (Offline-Betrieb). Ende, wenn alle fertig sind. */
export async function distributionView(container, verteilung) {
  const list = h('ul.dist');
  container.appendChild(list);
  let v = verteilung;
  for (;;) {
    list.replaceChildren(...Object.values(v.player).map((p) => {
      const pct = p.total ? Math.round((p.done / p.total) * 100) : p.phase === 'fertig' ? 100 : 0;
      return h(`li.${p.phase === 'fehler' ? 'err' : p.phase === 'fertig' ? 'ok' : 'run'}`, {},
        h('div.row', {}, h('strong', {}, p.name), h('span.state', {}, p.fehler ?? PHASE[p.phase] ?? p.phase)),
        h('div.progress', {}, h('div', { style: { width: `${pct}%` } })),
        p.phase === 'uebertragen' && p.total ? h('div.muted.small', {}, `${formatBytes(p.done)} von ${formatBytes(p.total)}`) : null);
    }));
    if (v.fertig) break;
    await new Promise((r) => setTimeout(r, 400));
    v = (await get(`/offline/verteilen/${v.id}`)).verteilung;
  }
  const failed = Object.values(v.player).filter((p) => p.phase === 'fehler').length;
  if (!Object.keys(v.player).length) container.appendChild(h('p.small', {}, 'Diesem Projekt ist noch kein Player zugeordnet. Unter „Geräte“ Player koppeln und zuordnen.'));
  else if (failed) container.appendChild(h('p.small', {}, `${failed} Player konnten nicht beliefert werden. Sie zeigen weiter ihren bisherigen Stand. Später unter „Geräte“ mit „Senden“ erneut versuchen.`));
  if (container.tagName === 'DIALOG') {
    container.appendChild(h('div.dialog-actions', {}, h('button.btn.primary', { onclick: () => container.remove() }, 'Schließen')));
  }
  return v;
}

export async function publish(projekt, saveNow, assets) {
  const steps = h('ol.steps');
  const step = (text, state = 'run') => {
    const li = h(`li.${state}`, {}, text);
    steps.appendChild(li);
    return (s, t) => {
      li.className = s;
      if (t) li.textContent = t;
    };
  };

  const ok = await dialog('Veröffentlichen', h('div', {},
    h('p', {}, mode.offline
      ? `Der aktuelle Entwurf von „${projekt.name}“ wird an alle zugeordneten Player im lokalen Netz gesendet.`
      : `Der aktuelle Entwurf von „${projekt.name}“ wird an alle zugeordneten Bildschirme verteilt.`),
    h('p.muted.small', {}, mode.offline
      ? 'Übertragen werden nur neue Dateien. Die Player schalten erst um, wenn alles vollständig und geprüft da ist.'
      : 'Die Player laden die Änderungen im Hintergrund und schalten erst um, wenn alles vollständig da ist.')),
  { ok: 'Jetzt veröffentlichen' });
  if (!ok) return null;

  const box = h('div', {}, steps);
  const dlg = h('dialog.dialog', {}, h('h2', {}, 'Veröffentlichen'), box);
  document.body.appendChild(dlg);
  dlg.showModal();
  const done = (actions) => {
    box.appendChild(h('div.dialog-actions', {}, actions));
  };

  const s1 = step('Entwurf speichern');
  try {
    await saveNow();
    s1('ok');
  } catch (e) {
    s1('err', `Speichern fehlgeschlagen: ${e.message}`);
    done(h('button.btn', { onclick: () => dlg.remove() }, 'Schließen'));
    return null;
  }

  const s2 = step('Dateien prüfen und Revision erzeugen');
  try {
    const { revision } = await post(`/projekte/${projekt.id}/veroeffentlichen`, {});
    s2('ok');
    step(`Revision ${revision.nummer} ist veröffentlicht (${revision.dateien} Dateien).`, 'ok');
    if (mode.offline) {
      const s3 = step('An die Player senden');
      try {
        const { verteilung } = await post('/offline/verteilen', { projektId: projekt.id });
        const v = await distributionView(box, verteilung);
        const failed = Object.values(v.player).some((p) => p.phase === 'fehler');
        s3(failed ? 'err' : 'ok', failed ? 'An die Player senden – teilweise fehlgeschlagen' : undefined);
      } catch (e) {
        s3('err', `Senden fehlgeschlagen: ${e.message}`);
      }
      done(h('button.btn.primary', { onclick: () => dlg.remove() }, 'Fertig'));
      return revision;
    }
    box.appendChild(h('p.muted.small', {}, 'Die Bildschirme aktualisieren sich innerhalb von etwa einer Minute. Den Stand je Gerät siehst du unter „Geräte“.'));
    done(h('button.btn.primary', { onclick: () => dlg.remove() }, 'Fertig'));
    return revision;
  } catch (e) {
    s2('err', e.message);
    if (e.code === 'files_not_ready') {
      box.appendChild(h('ul.problems', {}, Object.entries(e.details.dateien ?? {}).map(([ref, msg]) => h('li', {}, `${assets.get(ref)?.name ?? ref}: ${msg}`))));
    } else if (e.details?.errors) {
      box.appendChild(h('ul.problems', {}, e.details.errors.slice(0, 8).map((m) => h('li', {}, m))));
    }
    box.appendChild(h('p.small', {}, 'Es wurde nichts verändert – die Bildschirme zeigen weiter den bisherigen Stand.'));
    done(h('button.btn', { onclick: () => dlg.remove() }, 'Schließen'));
    return null;
  }
}
