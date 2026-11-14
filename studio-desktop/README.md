# Plinth Studio Desktop

Der Plinth-Designer als Programm für **Windows und macOS**, ganz ohne Server. Gestaltet wird mit derselben Oberfläche wie in der Cloud (`/studio`); veröffentlicht wird direkt an die Player im lokalen Netz. Bedienung und Protokoll: [`docs/offline.md`](../docs/offline.md).

## Aufbau

| Datei | Inhalt |
|---|---|
| `src/main.js` | Electron: startet den lokalen Server auf `127.0.0.1` (zufälliger Port) und öffnet das Studio-Fenster |
| `src/server.js` | Lokale `/api/v1` (Projekte, Entwürfe, Uploads, Dateien, Veröffentlichen) im selben Format wie die PHP-API, plus `/api/v1/offline/*` (Player, Kopplung, Verteilen) |
| `src/db.js` | Ablage als JSON-Datei (atomar geschrieben) |
| `src/players.js` | Suche per UDP-Broadcast, Kopplung, fortsetzbare Übertragung, Umschalten |

Schemaprüfung mit denselben JSON-Schemas aus `/shared/schemas` wie die Cloud.

## Entwicklung

```bash
npm install
npm start                        # Electron-Fenster
node scripts/dev-server.js 8098  # nur der lokale Server → http://127.0.0.1:8098/studio/
npm test                         # Ende-zu-Ende mit echtem Offline-Empfang des Players
```

## Bauen

```bash
npm run dist:win    # dist/PlinthStudioSetup-<version>.exe   (auf Windows)
npm run dist:mac    # dist/PlinthStudio-<version>-mac.dmg    (auf macOS)
```

Die CI (`.github/workflows/studio-desktop.yml`) baut beides auf Windows- und macOS-Runnern; bei Tags `v*` landen die Dateien im GitHub-Release. Noch ohne Code-Signing (#36).
