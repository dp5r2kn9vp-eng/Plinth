// Veröffentlichen: speichert, prüft und erzeugt eine neue Revision. Fehler zeigen genau, was fehlt.

import { post } from '../lib/api.js';
import { h, dialog } from '../lib/dom.js';

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
    h('p', {}, `Der aktuelle Entwurf von „${projekt.name}“ wird an alle zugeordneten Bildschirme verteilt.`),
    h('p.muted.small', {}, 'Die Player laden die Änderungen im Hintergrund und schalten erst um, wenn alles vollständig da ist.')),
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
