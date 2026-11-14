# Plinth auf den Webspace bringen

Für `https://plinth.klangniveau.de`. Alles funktioniert **ohne SSH** – nur mit FTP, phpMyAdmin und dem Browser. Die Hinweise zu **all-inkl (KAS)** stehen jeweils dabei.

## Inhalt des Pakets

Alles kommt in den Ordner, auf den die Subdomain zeigt – bei dir **`Plinth`**. Der Inhalt des ZIP entspricht genau diesem Ordner:

```text
Plinth/                      ← Ziel der Subdomain plinth.klangniveau.de
├── .htaccess                  Schutz interner Dateien, Weiterleitung aufs Studio
├── index.html
├── pruefung.php               Prüfseite + ersten Benutzer anlegen (nur mit Schlüssel)
├── cron.php                   Dateiprüfung für den Cronjob (nur mit Schlüssel)
├── config/
│   ├── .htaccess              sperrt den Ordner komplett
│   ├── plinth.env.vorlage     Vorlage
│   └── plinth.env             ← legst du an (Zugangsdaten)
├── api/
├── studio/
├── shared/
└── NICHT-HOCHLADEN/           bleibt auf deinem Rechner: ANLEITUNG.md, datenbank.sql
```

## 1. Cloudflare R2

Falls noch nicht geschehen (Details: Bucket `plinth-medien`, Location EU, öffentlicher Zugriff aus):

- **CORS-Regel** im Bucket (Settings → CORS policy):
  ```json
  [{ "AllowedOrigins": ["https://plinth.klangniveau.de"], "AllowedMethods": ["PUT", "GET", "HEAD"],
     "AllowedHeaders": ["*"], "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600 }]
  ```
- **API-Token** (R2 → Manage API Tokens): „Object Read & Write“, nur dieser Bucket → Access Key ID, Secret Access Key, EU-Endpoint `https://<ACCOUNT-ID>.eu.r2.cloudflarestorage.com`

## 2. PHP und HTTPS (all-inkl: KAS)

- **PHP-Version 8.2 oder neuer** einstellen (KAS → Domain bearbeiten → PHP-Version, z. B. 8.3)
- **SSL** aktivieren (KAS → Domain → SSL-Schutz → Let's Encrypt)

## 3. Datenbank

- Neue Datenbank anlegen (KAS → Datenbanken → Neue Datenbank). Name, Benutzer und Passwort notieren.
- **phpMyAdmin** öffnen (Link in der Datenbankliste) → Datenbank links auswählen → **Importieren** → `NICHT-HOCHLADEN/datenbank.sql` → OK.

## 4. `config/plinth.env` anlegen

Im Ordner `config` die Datei `plinth.env.vorlage` kopieren, als **`plinth.env`** speichern (Windows: darauf achten, dass sie nicht `plinth.env.txt` heißt) und ausfüllen:

```ini
APP_URL=https://plinth.klangniveau.de
APP_ENV=production
APP_DEBUG=false
API_BASE_PATH=/api

DB_HOST=localhost
DB_NAME=…              # aus Schritt 3
DB_USER=…
DB_PASS=…

SESSION_COOKIE_SECURE=true

S3_ENDPOINT=https://<ACCOUNT-ID>.eu.r2.cloudflarestorage.com
S3_REGION=auto
S3_PATH_STYLE=true
S3_BUCKET=plinth-medien
S3_KEY=…               # Access Key ID
S3_SECRET=…            # Secret Access Key
S3_PART_CHECKSUMS=true

# Schlüssel für Prüfseite und Cronjob: je mind. 20 zufällige Zeichen (z. B. aus einem Passwortgenerator)
CHECK_TOKEN=…
CRON_TOKEN=…
```

Sie liegt dann in `Plinth/config/plinth.env`. Der Ordner `config` ist durch seine eigene `.htaccess` für Besucher komplett gesperrt.

## 5. Hochladen

Per FTP alles aus dem ZIP **außer `NICHT-HOCHLADEN`** direkt in den Ordner `Plinth` laden – ohne Zwischenordner (also `Plinth/api/…`, nicht `Plinth/plinth-ftp/api/…`).
Im FTP-Programm „versteckte Dateien anzeigen“ einschalten, damit `.htaccess`, `config/.htaccess` und `api/.htaccess` mitkommen. Bestehende Dateien **überschreiben**, `config/plinth.env` nicht.

## 6. Prüfen und ersten Benutzer anlegen – im Browser

`https://plinth.klangniveau.de/pruefung.php?token=<CHECK_TOKEN>` öffnen.

- Alles grün → „Alles bereit“. Rote Punkte zeigen jeweils, was zu tun ist.
- Unten prüft die Seite den **Upload aus dem Browser** (CORS). Bei Fehler: CORS-Regel aus Schritt 1 prüfen – Domain exakt mit `https://`, ohne `/` am Ende.
- Solange es noch keinen Benutzer gibt, erscheint **„Ersten Benutzer anlegen“**: Firma, Name, E-Mail, Passwort → danach wird der **Kundencode** für die Player angezeigt.

Danach in der `plinth.env` die Zeile `CHECK_TOKEN=…` löschen – die Prüfseite ist dann aus.

## 7. Cronjob für die Dateiprüfung

all-inkl: KAS → Tools → Cronjobs → Neuer Cronjob

- URL: `https://plinth.klangniveau.de/cron.php?token=<CRON_TOKEN>`
- Zeit: alle 10 Minuten

(Hoster mit Shell-Cronjobs: `php /pfad/zum/webroot/api/bin/verify-files.php --limit=5`)

## 8. Testen

1. `https://plinth.klangniveau.de/` → Studio-Anmeldung (nicht auf einen Serverpfad wie `/www/htdocs/…`)
2. `https://plinth.klangniveau.de/config/plinth.env` → **nicht** abrufbar (403)
3. Im Studio anmelden, Video hochladen, einfügen, **Veröffentlichen**
4. Player installieren (`PlinthSetup-x.y.z.exe`), Kundencode eingeben → Inhalt erscheint

**Upload scheitert mit „Speicher antwortet 400/501“:** in `plinth.env` `S3_PART_CHECKSUMS=false` setzen.

## Updates

Neues Paket hochladen (alles überschreiben außer `config/plinth.env`). Bringt ein Update neue Tabellen mit, steht das in den Versionshinweisen; die Prüfseite meldet dann „Tabellen“ rot.

## Mit SSH (optional)

```bash
php api/bin/check.php
php api/bin/migrate.php
php api/bin/create-user.php --kunde="Kundenname" --email=name@firma.de --name="Vorname Nachname"
```
