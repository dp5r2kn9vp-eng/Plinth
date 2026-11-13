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

Die `.env` wird aus dem Repo-Hauptordner gelesen (oder aus `PLINTH_ENV_FILE`).
Auf Apache leitet `api/.htaccess` alle Anfragen auf `public/index.php`; `src/`, `vendor/` usw. sind nicht direkt abrufbar.

## Endpunkte

| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/api/v1/health` | Lebenszeichen |
| POST | `/api/v1/auth/login` | `{email, password, remember}` → setzt Sitzungscookie |
| POST | `/api/v1/auth/logout` | beendet die Sitzung |
| GET | `/api/v1/auth/me` | angemeldeter Benutzer, sonst 401 |

### Fehlerformat

Jeder Fehler hat dieselbe Form; `requestId` steht auch im Header `X-Request-Id` und im Log.

```json
{ "error": { "code": "invalid_credentials", "message": "E-Mail oder Passwort ist falsch.", "requestId": "a5f36ae944c572b7" } }
```

Codes: `invalid_json` (400), `unauthorized`/`invalid_credentials` (401), `forbidden` (403), `not_found` (404),
`method_not_allowed` (405), `unsupported_media_type` (415), `validation_failed` (422, mit `details.fields`),
`too_many_requests` (429, mit `Retry-After`), `internal_error` (500).

## Sicherheit

- Passwörter mit Argon2id; unbekannte E-Mail und falsches Passwort sind von außen nicht unterscheidbar.
- Sitzungstoken: 256 Bit Zufall im Cookie `plinth_session` (HttpOnly, Secure, SameSite=Strict, Path=/api); in der DB nur der SHA-256-Hash.
- Ohne „Angemeldet bleiben“ läuft die Sitzung nach `SESSION_TTL_HOURS` ab, sonst nach `SESSION_REMEMBER_DAYS`.
- Gesperrte Benutzer oder Kunden verlieren sofort den Zugriff.
- Schreibende Requests nur mit `Content-Type: application/json` und passendem `Origin` (CSRF-Schutz).
- Rate-Limiting beim Login: 5 Versuche pro IP+E-Mail und 30 pro IP in 15 Minuten (`RateLimiter`, auch für Geräte-Endpunkte nutzbar).
- Hinter einem Reverse-Proxy/CDN ist `REMOTE_ADDR` die Proxy-IP – dann muss die echte Client-IP ergänzt werden.

## Tests

Benötigen eine eigene, leere MySQL/MariaDB-Datenbank (wird bei jedem Lauf geleert):

```bash
TEST_DB_NAME=plinth_test TEST_DB_USER=plinth TEST_DB_PASS=... vendor/bin/phpunit
```
