# Plinth – Hinweise für Claude

Digital-Signage-System für Windows-Kiosk-Displays: Kunden gestalten Bildschirminhalte im Web-Designer (Studio), veröffentlichen sie, und die Player auf den Kiosk-Rechnern spielen sie offline ab. Überblick: `README.md`, Entscheidungen: `docs/architektur.md`.

## Stand des Repos (entfernen, sobald der PR-Stapel gemergt ist)

`main` enthält bisher nur Doku und Tickets. Der Code liegt im gestapelten PR-Stapel #43 → #51 (jeder PR baut auf dem vorigen auf, `deploy-paket` ist die Spitze). Vor neuer Arbeit klären, ob auf `main` oder auf der Spitze des Stapels aufgesetzt wird.

## Aufbau

| Ordner | Inhalt | Technik |
|---|---|---|
| `api/` | Backend unter `/api/v1` | PHP ≥ 8.2, Composer, **kein Framework**, MySQL/MariaDB, AWS SDK (nur S3) |
| `studio/` | Designer (Web) | Plain JavaScript als ES-Module, **kein Build-Schritt**, eigener DOM-Editor (kein Canvas/Konva/Fabric) |
| `player/` | Windows-Player | Electron, electron-builder |
| `shared/` | JSON-Schemas (Draft 2020-12), Beispiele, gemeinsamer Renderer `shared/renderer` | |
| `installer/` | Windows-Installer, Kiosk-Skripte | Inno Setup |
| `tools/` | Dev-Server-Router, FTP-Paket (`build-ftp.sh`), Deploy-Anleitung | |
| `tests/` | Studio-Ende-zu-Ende | Playwright |
| `docs/` | Architektur, Entwicklung, Kiosk, Abnahme, Admin-Konsole, Tickets | |
| `admin/` (geplant, M4) | Betreiber-Konsole | eigene Laravel-App, siehe `docs/ADMINKONSOLE.md` |

## Architekturregeln (nicht ohne Rücksprache ändern)

- **Große Dateien laufen nie durch PHP.** Die API stellt nur zeitlich begrenzte, signierte S3-URLs aus; Browser lädt direkt hoch (Multipart), Player lädt direkt herunter. Bucket ist privat.
- **Ein Renderer für Studio-Vorschau und Player** (`shared/renderer`). Darstellungsänderungen dort machen, nicht doppelt.
- **Layouts in Bezugseinheiten** (quer 1920×1080, hochkant 1080×1920), skaliert wird erst beim Anzeigen.
- **Revisionen und Manifeste sind unveränderlich.** Veröffentlichen ist atomar: entweder vollständige aktive Revision oder keine Änderung. Dateien sind über SHA-256 adressiert (`media/<sha256>.<ext>`).
- **Player bleibt offlinefähig** und schaltet erst um, wenn alle Dateien geladen und geprüft sind; die vorige Revision bleibt als Rückfall.
- **Zahlungsverzug stoppt nie die Wiedergabe** (gesperrt werden nur Upload/Veröffentlichen im Studio).
- Schemaänderungen immer in `shared/schemas` + Beispiele + `shared/README.md`; die API validiert damit (`api/src/Schema/SchemaValidator.php`).
- **Tabellenhoheit:** Kerntabellen gehören der API (`api/migrations/NNN_name.sql`, fortlaufend nummeriert, nie bestehende Migrationen ändern). Tabellen der Admin-App mit Präfix `adm_`; die API liest sie nie.

## Betrieb und Hosting

- Produktiv: `https://plinth.klangniveau.de` auf Shared Hosting bei all-inkl (KAS), **ohne SSH**: Auslieferung per FTP-Paket (`tools/build-ftp.sh`, Anleitung `tools/deploy/ANLEITUNG.md`), Cronjobs als Webcron (`cron.php` mit `CRON_TOKEN`). Lösungen müssen dort laufen: keine Daemons, keine Queues, kein Node auf dem Server.
- Speicher: Cloudflare R2 (EU), S3-kompatibel; Hetzner Object Storage soll ebenfalls funktionieren.
- Alle Zeitstempel in der DB in UTC; fachliche Tagesläufe in Europe/Berlin.

## Entwicklung und Tests

Ausführlich in `docs/entwicklung.md`. Kurzfassung:

- Lokal: MariaDB, S3-Emulator `moto_server -p 5055`, `.env` über `PLINTH_ENV_FILE`, dann `php api/bin/migrate.php && php api/bin/seed-dev.php && php api/bin/s3-setup.php --create-bucket` und `php -S 127.0.0.1:8099 tools/dev-server/router.php`.
- API: `cd api && vendor/bin/phpunit` (braucht `TEST_DB_*`, `TEST_S3_ENDPOINT`; die Test-DB wird bei jedem Lauf geleert).
- Player: `cd player && npm test`, E2E mit `xvfb-run -a npm run test:e2e` (unter Linux als root `--no-sandbox`).
- Studio E2E: `cd tests && npm run e2e`.
- CI: `.github/workflows/ci.yml` (Ubuntu, alle Tests), `windows.yml` (Player + Installer bauen und testen, Release bei Tag `v*`).
- Neue Endpunkte und Verhalten mit Tests absichern; vor einem PR die betroffenen Tests lokal laufen lassen.

## Konventionen

- **Sprache:** Doku, UI-Texte, Commit-Nachrichten und PR-Beschreibungen auf Deutsch. Fachbegriffe im Code ebenfalls deutsch wie im Bestand (`kunden`, `geraete`, `revisionen`, `PublishService`), API-Pfade deutsch (`/projekte/{id}/veroeffentlichen`).
- **API-Fehler** immer im einheitlichen Format `{ "error": { "code", "message", "requestId" } }` mit englischem `snake_case`-Code und deutscher Meldung (Liste in `api/README.md`).
- Endpunkte, Tabellen und Abläufe in der jeweiligen README dokumentieren, wenn sie sich ändern.
- Arbeit auf eigenem Branch, ein PR pro Ticket bzw. zusammenhängendem Thema; im PR-Text `Closes #n` und Abschnitte Inhalt / Tests / Hinweise.

## Sicherheit

- Zugangsdaten nur in der `.env` (produktiv `config/plinth.env`), nie im Repo, nie in Logs. Vorlage: `.env.example` – neue Variablen dort mit Kommentar ergänzen.
- Passwörter Argon2id; Tokens nur als SHA-256-Hash in der DB; schreibende Requests nur als JSON mit passendem `Origin`; Rate-Limiting über `RateLimiter`.
- Player-Token per DPAPI (`safeStorage`), Wartungs-PIN als scrypt-Hash.

## Tickets

Quelle ist `docs/tickets/tickets.py`; `TICKETS.md` wird daraus erzeugt (`python3 tickets.py md` im Ordner `docs/tickets/`), nicht von Hand bearbeiten. Meilensteine: M1 MVP, M2 Betrieb, M3 Cloud, M4 Betreiber & Abrechnung.
