# Plinth auf den Webspace bringen

Dieses Paket enthält alles für `https://plinth.klangniveau.de`:

| Datei/Ordner | Wohin | Zweck |
|---|---|---|
| `.htaccess`, `index.html` | Webroot | Schutz interner Dateien, Weiterleitung auf das Studio |
| `api/` | Webroot | PHP-Backend inkl. `vendor/` (fertig installiert) |
| `studio/` | Webroot | Plinth Studio (Designer) |
| `shared/` | Webroot | Layout-Renderer und Schemas |
| `plinth.env.vorlage` | **nicht** hochladen – ausfüllen und als `plinth.env` **eine Ebene über** dem Webroot ablegen | Zugangsdaten |
| `datenbank.sql` | **nicht** hochladen – in phpMyAdmin importieren | Datenbankschema |
| `ANLEITUNG.md` | – | diese Anleitung |

## Voraussetzungen beim Hoster

- Apache mit `mod_rewrite` und `.htaccess` (bei den meisten Hostern Standard)
- PHP 8.2 oder neuer mit `pdo_mysql`, `mbstring`, `curl`, `openssl`
- MySQL/MariaDB-Datenbank mit Benutzer
- HTTPS-Zertifikat für die Domain
- Cronjobs (für die Dateiprüfung); SSH ist hilfreich, aber nicht nötig

## Schritt 1 – Cloudflare R2 (Speicher für Videos und Bilder)

1. Im Cloudflare-Dashboard links **R2 Object Storage** öffnen und aktivieren (Zahlungsmittel hinterlegen; 10 GB Speicher frei, Downloads kostenlos).
2. **Create bucket**
   - Name: `plinth-medien`
   - Location: **Specify jurisdiction → European Union (EU)** (Daten bleiben in der EU)
3. Bucket öffnen → **Settings**
   - **Public access**: ausgeschaltet lassen (kein r2.dev, keine Custom Domain). Alle Zugriffe laufen über zeitlich begrenzte, signierte Links.
   - **CORS policy → Add CORS policy** und diesen Inhalt einfügen:
     ```json
     [
       {
         "AllowedOrigins": ["https://plinth.klangniveau.de"],
         "AllowedMethods": ["PUT", "GET", "HEAD"],
         "AllowedHeaders": ["*"],
         "ExposeHeaders": ["ETag"],
         "MaxAgeSeconds": 3600
       }
     ]
     ```
4. Zurück zur R2-Übersicht → **Manage R2 API Tokens → Create API token**
   - Name: `plinth-server`
   - Permissions: **Object Read & Write**
   - Specify bucket(s): **nur `plinth-medien`**
   - TTL: Forever
   - **Create** → angezeigt werden **Access Key ID**, **Secret Access Key** (nur einmal sichtbar!) und die **S3-Endpoints**. Den Endpoint für die **EU-Jurisdiction** nehmen: `https://<ACCOUNT-ID>.eu.r2.cloudflarestorage.com`
5. Diese vier Werte kommen in Schritt 3 in die `plinth.env`. **Nicht per Mail oder Chat weitergeben.**

## Schritt 2 – Datenbank

Im Hoster-Menü eine Datenbank und einen Benutzer anlegen, dann:

- **mit SSH:** später `php api/bin/migrate.php` (Schritt 5)
- **ohne SSH:** phpMyAdmin öffnen → Datenbank auswählen → **Importieren** → `datenbank.sql`

## Schritt 3 – `plinth.env` anlegen

`plinth.env.vorlage` kopieren, als **`plinth.env`** speichern und ausfüllen:

```ini
APP_URL=https://plinth.klangniveau.de
APP_ENV=production
APP_DEBUG=false
API_BASE_PATH=/api

DB_HOST=localhost
DB_PORT=3306
DB_NAME=…            # aus Schritt 2
DB_USER=…
DB_PASS=…

SESSION_COOKIE_SECURE=true

S3_ENDPOINT=https://<ACCOUNT-ID>.eu.r2.cloudflarestorage.com
S3_REGION=auto
S3_PATH_STYLE=true
S3_BUCKET=plinth-medien
S3_KEY=…             # Access Key ID
S3_SECRET=…          # Secret Access Key
S3_PART_CHECKSUMS=true
```

Ablageort: **eine Ebene über dem Webroot**, also neben dem Ordner, der die Website enthält. Beispiel:

```text
/home/kunde/
├── plinth.env            ← hier (nicht im Web erreichbar)
└── plinth.klangniveau.de/  ← Webroot: .htaccess, api/, studio/, shared/, index.html
```

Hat der Hoster keinen Ordner über dem Webroot, die Datei als `.env` direkt in den Webroot legen – die mitgelieferte `.htaccess` sperrt sie dann (danach im Browser prüfen: `https://plinth.klangniveau.de/.env` muss **403** liefern).

## Schritt 4 – Hochladen

Per FTP/SFTP den **Inhalt** von `.htaccess`, `index.html`, `api/`, `studio/`, `shared/` in den Webroot laden. Wichtig: auch versteckte Dateien (`.htaccess`, `api/.htaccess`) – im FTP-Programm „versteckte Dateien anzeigen“ aktivieren.

Der Ordner `api/storage/logs/` muss für PHP beschreibbar sein (meist automatisch; sonst Rechte 755/775).

## Schritt 5 – Prüfen und ersten Benutzer anlegen

**Mit SSH** (im Webroot):

```bash
php api/bin/check.php          # prüft PHP, plinth.env, Datenbank, R2
php api/bin/migrate.php        # nur wenn datenbank.sql nicht importiert wurde
php api/bin/create-user.php --kunde="Kundenname" --email=name@firma.de --name="Vorname Nachname"
```

**Ohne SSH:** im Hoster-Menü jeweils einen Cronjob anlegen, **einmal laufen lassen** und danach wieder löschen (die Ausgabe kommt meist per Mail):

```text
php /pfad/zum/webroot/api/bin/check.php
PLINTH_PASSWORD='SicheresPasswort123' php /pfad/zum/webroot/api/bin/create-user.php --kunde="Kundenname" --email=name@firma.de --name="Vorname Nachname"
```

`create-user.php` gibt auch den **Kundencode** für die Player aus (steht später im Studio unter „Geräte“).

## Schritt 6 – Cronjob für die Dateiprüfung (dauerhaft)

```text
*/10 * * * *   php /pfad/zum/webroot/api/bin/verify-files.php --limit=5
```

Prüft hochgeladene Dateien serverseitig per SHA-256.

## Schritt 7 – Testen

1. `https://plinth.klangniveau.de/api/v1/health` → `{"status":"ok","version":"v1"}`
2. `https://plinth.klangniveau.de/.env` und `https://plinth.klangniveau.de/api/src/App.php` → **nicht** abrufbar (403/404)
3. `https://plinth.klangniveau.de/` → Studio-Anmeldung, mit dem Benutzer aus Schritt 5 anmelden
4. Im Studio ein Video hochladen, einfügen, **Veröffentlichen**
5. Player installieren (`PlinthSetup-x.y.z.exe`), Kundencode eingeben → Inhalt erscheint

**Falls der Upload im Studio mit „Speicher antwortet 400/501“ scheitert:** in `plinth.env` `S3_PART_CHECKSUMS=false` setzen und erneut versuchen.
**Falls „ETag fehlt (CORS)“:** CORS-Regel aus Schritt 1.3 prüfen (Domain exakt mit `https://`, ohne `/` am Ende).

## Updates

Neues Paket bauen (`tools/build-ftp.sh`), `api/`, `studio/`, `shared/` überschreiben (**`plinth.env` bleibt unberührt**), danach `php api/bin/migrate.php` (bzw. neue Einträge aus `datenbank.sql` importieren).
