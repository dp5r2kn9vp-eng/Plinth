# Plinth Player

Windows-App (Electron), die veröffentlichte Inhalte lokal vorhält und im Vollbild abspielt – auch offline.

## Ablauf

1. **Erster Start:** ohne Eingabe im **Offline-Betrieb**: Der Player zeigt Kopplungscode und IP-Adresse und wartet auf Plinth Studio Desktop im lokalen Netz (siehe [`docs/offline.md`](../docs/offline.md)). Für die Cloud: Kundencode über `provision.json` bzw. Installer-Parameter (siehe unten) oder im Wartungsmenü *Mit Plinth Cloud verbinden*.
2. **Synchronisation:** alle ~45 s (±20 %) fragt der Player die Revisionsnummer ab (ETag, meist 304). Bei Änderung lädt er das Manifest und **nur fehlende Dateien** (SHA-256-adressiert), fortsetzbar per HTTP-Range, prüft jede Datei per SHA-256 und schaltet **erst um, wenn alles da ist**. Die vorige Revision bleibt als Rückfall erhalten; nicht mehr benötigte Dateien werden gelöscht.
3. **Wiedergabe:** derselbe Renderer wie die Studio-Vorschau (`/shared/renderer`): Startseite → Video/Seite → zurück, nach Videoende automatisch zurück, Inaktivitäts-Timeout aus dem Layout. Maus und Touch gleich (Pointer-Events), Mauszeiger optional ausgeblendet.
4. **Offline:** zeigt den zuletzt geladenen Stand; ein kleiner gelber Punkt unten rechts zeigt „keine Verbindung“.

## Wartung

- **Strg + Alt + Umschalt + K** oder **5× schnell in die Ecke oben links tippen** → PIN-Eingabe (Ziffernblock, auch für Touch)
- Falsche PIN: kein Hinweis auf dem Bildschirm; nach 5 Fehlversuchen 5 min Sperre (verdoppelt sich bis max. 1 h)
- Menü: **Windows nutzen 15/60 min** (Kiosk wird verlassen, Explorer/Taskleiste nutzbar, danach automatisch zurück), **Jetzt synchronisieren**, **Mauszeiger ein/aus**, **Status & Protokoll**, **Neu einrichten**, **Player beenden** (Watchdog pausiert bis zum nächsten Windows-Start oder bis Plinth manuell gestartet wird)

## Techniker-Anzeige

Dezenter Punkt unten rechts: grün pulsierend = lädt, gelb = offline, rot = Fehler/gesperrt. Details im Wartungsmenü unter „Status & Protokoll“.

Logdatei: `%ProgramData%\Plinth\logs\player.log` (Rotation bei 5 MB, 4 alte Dateien).

## Watchdog

Der Autostart startet `Plinth.exe --watchdog`. Der Watchdog startet den Player, startet ihn nach Absturz neu (2 s; bei mehr als 5 Abstürzen in 2 min: 30 s) und beendet ihn, wenn 60 s kein Lebenszeichen kommt. Im Wartungsmodus startet er nicht neu. Stürzt nur die Darstellung ab oder hängt sie, lädt der Player sie selbst neu.

## Daten

`%ProgramData%\Plinth` (überschreibbar mit `PLINTH_DATA_DIR`):

| Pfad | Inhalt |
|---|---|
| `config.json` | Server, Gerätename, Token (per DPAPI verschlüsselt), PIN (scrypt-Hash), Optionen |
| `media/` | Medien `<sha256>.<ext>` |
| `manifests/`, `state.json` | aktuelle und vorige Revision |
| `tmp/` | angefangene Downloads |
| `maintenance.json`, `pin-lock.json` | Wartungsmodus, PIN-Sperre |
| `logs/` | Protokoll |

Hinweis: DPAPI bindet das Token an das Windows-Konto. Wechselt das Konto, fragt der Player erneut nach dem Kundencode.

## Zero-Touch-Rollout

Liegt beim ersten Start `%ProgramData%\Plinth\provision.json` vor, richtet sich der Player selbst ein und löscht die Datei:

```json
{ "kundencode": "ABCD-EFGH-JKMN", "pin": "4711", "apiUrl": "https://plinth.example.de/api", "name": "Foyer links", "hideCursor": true }
```

`name` ist optional (Standard: Computername). So lässt sich auch eine einheitliche Wartungs-PIN pro Kunde verteilen.

## Entwicklung

```bash
npm install
npm start                       # Fenster statt Kiosk
PLINTH_API_URL=http://localhost:8099/api PLINTH_DATA_DIR=/tmp/plinth npm start
npm test                        # Unit-Tests (+ Integration, wenn PLINTH_URL gesetzt)
xvfb-run -a env PLINTH_URL=http://localhost:8099 MEDIA_DIR=/tmp/plinth-media npm run test:e2e
```

Unter Linux als root zusätzlich `--no-sandbox` übergeben.
