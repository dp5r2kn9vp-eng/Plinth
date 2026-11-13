# Plinth API

PHP-Backend (PHP ≥ 8.2, MySQL/MariaDB). Alle Endpunkte liegen unter `/api/v1`.

## Einrichtung

```bash
cd api
composer install --no-dev
cp ../.env.example ../.env   # Werte eintragen
php bin/migrate.php
php bin/create-user.php --kunde="Musterfirma" --email=name@firma.de --name="Vorname Nachname"
```

Speicher einrichten (CORS für direkte Browser-Uploads von `APP_URL`):

```bash
php bin/s3-setup.php
```

Cronjob für die serverseitige SHA-256-Prüfung hochgeladener Dateien (streamt aus dem Speicher, braucht wenig RAM):

```cron
*/10 * * * * php /pfad/zu/api/bin/verify-files.php --limit=5
```

Für Entwicklung und Abnahme legt `php bin/seed-dev.php` zwei Testkunden mit Benutzer, Projekt und Start-Entwurf an (nur mit `APP_ENV=development`).

Die `.env` wird aus dem Repo-Hauptordner gelesen (oder aus `PLINTH_ENV_FILE`).
Auf Apache leitet `api/.htaccess` alle Anfragen auf `public/index.php`; `src/`, `vendor/` usw. sind nicht direkt abrufbar.

## Endpunkte

| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/api/v1/health` | Lebenszeichen |
| POST | `/api/v1/auth/login` | `{email, password, remember}` → setzt Sitzungscookie |
| POST | `/api/v1/auth/logout` | beendet die Sitzung |
| GET | `/api/v1/auth/me` | angemeldeter Benutzer, sonst 401 |
| GET | `/api/v1/kunde` | eigener Kunde inkl. Kundencode (`ABCD-EFGH-JKMN`) |
| POST | `/api/v1/kunde/kundencode` | neuen Kundencode erzeugen (registrierte Geräte bleiben) |
| GET | `/api/v1/geraete` | Geräte des Kunden mit Status |
| PATCH | `/api/v1/geraete/{id}` | `{name?, gesperrt?, projektId?}` |
| DELETE | `/api/v1/geraete/{id}` | Gerät entfernen (Token wird ungültig) |

### Projekte und Veröffentlichen

| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/api/v1/projekte` | Projekte mit aktueller Revisionsnummer |
| POST | `/api/v1/projekte` | `{name, ausrichtung: landscape\|portrait}` legt Projekt mit Start-Entwurf an |
| PATCH | `/api/v1/projekte/{id}` | `{name}` |
| GET | `/api/v1/projekte/{id}/entwurf` | `{layout, version, aktualisiertAm}` |
| PUT | `/api/v1/projekte/{id}/entwurf` | `{layout, version}`; 422 `invalid_layout`, 409 `draft_conflict` wenn inzwischen jemand anderes gespeichert hat |
| POST | `/api/v1/projekte/{id}/veroeffentlichen` | `{gueltigAb?, gueltigBis?, prioritaet?}` → `{revision: {nummer, dateien, groesse}}`; 422 `files_not_ready` mit betroffenen Dateien |
| GET | `/api/v1/projekte/{id}/revisionen` | letzte 100 Revisionen |

Beim Veröffentlichen wird alles geprüft, bevor die Revision angelegt wird (Schema, Dateien fertig und im Speicher vorhanden). Danach gibt es entweder eine vollständige, aktive Revision oder keine Änderung. Thumbnails ohne eigenes Vorschaubild bekommen das Standbild des Videos.

### Medien

Der Browser lädt direkt in den Speicher; durch PHP laufen nur kleine JSON-Anfragen.

| Methode | Pfad | Beschreibung |
|---|---|---|
| POST | `/api/v1/uploads` | `{name, mime, groesse}` → Datei-ID, `teilGroesse` (≥ 8 MiB), `teileAnzahl` |
| POST | `/api/v1/uploads/{id}/teile` | `{teile: [1,2,…], pruefsummen?: {"1": "<sha256-base64>"}}` → signierte PUT-URLs (1 h gültig) |
| GET | `/api/v1/uploads/{id}` | Stand inkl. `fertigeTeile` für die Wiederaufnahme |
| POST | `/api/v1/uploads/{id}/abschliessen` | `{teile: [{nummer, etag}], sha256}` → prüft die Größe, Status `fertig` |
| DELETE | `/api/v1/uploads/{id}` | Upload abbrechen |
| GET | `/api/v1/dateien` | Bibliothek (mit signierter Vorschau-URL) |
| GET/PATCH/DELETE | `/api/v1/dateien/{id}` | Details; Name, `breite`, `hoehe`, `dauerSekunden`, `vorschauDateiId` |

Erlaubt: JPEG, PNG, WebP, MP4, WebM bis `UPLOAD_MAX_GB`. Werden Prüfsummen pro Teil mitgeschickt, lehnt der Speicher veränderte Teile ab (der Browser muss dann den Header `x-amz-checksum-sha256` senden).
Großer Ende-zu-Ende-Test gegen eine laufende Installation: `php bin/upload-smoke.php --api=https://host/api --email=… --password=… --gb=2`.

### Player (Header `Authorization: Bearer <gerätetoken>`)

| Methode | Pfad | Beschreibung |
|---|---|---|
| POST | `/api/v1/player/registrieren` | `{kundencode, name, appVersion}` → `{geraetId, token}` (10 Versuche/15 min pro IP) |
| GET | `/api/v1/player/geraet` | eigenes Gerät; 401 `device_unknown`, 403 `device_blocked` |

| GET | `/api/v1/player/revision` | `{revision, projektId}` mit `ETag`; mit `If-None-Match` → 304 (für Polling alle 30–60 s) |
| GET | `/api/v1/player/manifest[?revision=n]` | `{manifest, downloads: {dateiId: url}, gueltigBis}`; 404 `no_revision` |
| POST | `/api/v1/player/status` | `{geladeneRevision}` |

Ein Gerät spielt das ihm zugewiesene Projekt, sonst das erste Projekt des Kunden. Download-Links sind `DOWNLOAD_URL_TTL_HOURS` gültig (Standard 6 h).
Der Player sendet optional `X-Plinth-Version`. Pro Gerät sind 300 Anfragen in 15 Minuten erlaubt.

### Fehlerformat

Jeder Fehler hat dieselbe Form; `requestId` steht auch im Header `X-Request-Id` und im Log.

```json
{ "error": { "code": "invalid_credentials", "message": "E-Mail oder Passwort ist falsch.", "requestId": "a5f36ae944c572b7" } }
```

Codes: `invalid_json` (400), `unauthorized`/`invalid_credentials` (401), `forbidden` (403), `not_found` (404),
`method_not_allowed` (405), `unsupported_media_type` (415), `validation_failed` (422, mit `details.fields`),
`too_many_requests` (429, mit `Retry-After`), `internal_error` (500).

## Datenbank

| Tabelle | Inhalt |
|---|---|
| `kunden` | Kunde, Kundencode, aktiv |
| `benutzer` | Designer-Benutzer (Argon2id) |
| `auth_sessions` | Sitzungen (Token-Hash) |
| `projekte` | Bildschirm-Projekte eines Kunden (Ausrichtung) |
| `entwuerfe` | ein Entwurf pro Projekt (Layout-JSON, Version) |
| `dateien` | Medien im Speicher (Status, SHA-256, Prüfzeitpunkt, Vorschaubild) |
| `revisionen` | veröffentlichte, unveränderliche Manifeste |
| `zeitplaene` | Zeitfenster für Revisionen (ab M2) |
| `geraete` | Player (Token-Hash, gesperrt, geladene Revision) |
| `rate_limits` | Zähler fürs Rate-Limiting |

Alle Zeitstempel in UTC.

## Sicherheit

- Passwörter mit Argon2id; unbekannte E-Mail und falsches Passwort sind von außen nicht unterscheidbar.
- Sitzungstoken: 256 Bit Zufall im Cookie `plinth_session` (HttpOnly, Secure, SameSite=Strict, Path=/api); in der DB nur der SHA-256-Hash.
- Ohne „Angemeldet bleiben“ läuft die Sitzung nach `SESSION_TTL_HOURS` ab, sonst nach `SESSION_REMEMBER_DAYS`.
- Gesperrte Benutzer oder Kunden verlieren sofort den Zugriff.
- Schreibende Requests nur mit `Content-Type: application/json` und passendem `Origin` (CSRF-Schutz).
- Rate-Limiting beim Login: 5 Versuche pro IP+E-Mail und 30 pro IP in 15 Minuten (`RateLimiter`, auch für Geräte-Endpunkte nutzbar).
- Hinter einem Reverse-Proxy/CDN ist `REMOTE_ADDR` die Proxy-IP – dann muss die echte Client-IP ergänzt werden.

## Tests

Benötigen eine eigene, leere MySQL/MariaDB-Datenbank (wird bei jedem Lauf geleert) und für die Upload-Tests einen S3-kompatiblen Testspeicher:

```bash
pip install "moto[server]" && moto_server -p 5055 &
TEST_DB_NAME=plinth_test TEST_DB_USER=plinth TEST_DB_PASS=... TEST_S3_ENDPOINT=http://127.0.0.1:5055 vendor/bin/phpunit
```
