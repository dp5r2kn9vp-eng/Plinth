# Entwicklung und Tests

## Voraussetzungen

PHP ≥ 8.2 mit `pdo_mysql`, Composer, MySQL/MariaDB, Node.js 22, Python 3 (für den S3-Emulator), für Player-E2E unter Linux `xvfb-run`.

## Lokale Installation

```bash
# Datenbanken
mysql -uroot -e "CREATE DATABASE plinth; CREATE DATABASE plinth_test;
  CREATE USER 'plinth'@'localhost' IDENTIFIED BY 'plinth';
  GRANT ALL ON plinth.* TO 'plinth'@'localhost'; GRANT ALL ON plinth_test.* TO 'plinth'@'localhost';"

# S3-Emulator
pip install "moto[server]" && moto_server -p 5055 &

# API
cd api && composer install && cd ..
cat > dev.env <<'ENV'
APP_URL=http://127.0.0.1:8099
APP_ENV=development
DB_HOST=127.0.0.1
DB_NAME=plinth
DB_USER=plinth
DB_PASS=plinth
SESSION_COOKIE_SECURE=false
S3_ENDPOINT=http://127.0.0.1:5055
S3_REGION=us-east-1
S3_BUCKET=plinth-dev
S3_KEY=test
S3_SECRET=test
ENV
export PLINTH_ENV_FILE=$PWD/dev.env
php api/bin/migrate.php && php api/bin/seed-dev.php && php api/bin/s3-setup.php --create-bucket
php -S 127.0.0.1:8099 tools/dev-server/router.php
```

Studio: <http://127.0.0.1:8099/studio/> – Testbenutzer `demo@plinth.test` / `praxis@plinth.test`, Passwort `Demo-Passwort-2026`.

Player gegen die lokale Installation:

```bash
cd player && npm install
PLINTH_API_URL=http://127.0.0.1:8099/api PLINTH_DATA_DIR=/tmp/plinth-player npm start
```

## Tests

| Was | Befehl |
|---|---|
| API (PHPUnit) | `cd api && TEST_DB_PASS=plinth TEST_S3_ENDPOINT=http://127.0.0.1:5055 vendor/bin/phpunit` |
| Player Unit + Integration | `cd player && PLINTH_URL=http://127.0.0.1:8099 npm test` |
| Studio E2E | `cd tests && npm install && PLINTH_URL=http://127.0.0.1:8099 npm run e2e` |
| Player E2E (Electron) | `cd player && PLINTH_URL=http://127.0.0.1:8099 xvfb-run -a npm run test:e2e` |
| Installer (Windows, Admin) | `./installer/test-installer.ps1 -Setup dist/PlinthSetup-1.0.0.exe` |

Hinweis: Die API begrenzt Registrierungen (10 pro 15 min und IP). Bei vielen Testläufen hintereinander ggf. `DELETE FROM rate_limits` ausführen.

## CI

- `.github/workflows/ci.yml`: alle Tests oben auf Ubuntu (MariaDB-Service, moto, PHP-Server, Playwright, Electron unter Xvfb)
- `.github/workflows/windows.yml`: baut Player (electron-builder) und Installer (Inno Setup) auf Windows, prüft den Installer mit `installer/test-installer.ps1`; bei Tags `v*` entsteht ein GitHub-Release mit `PlinthSetup-x.y.z.exe`

Release erstellen:

```bash
git tag v1.0.0 && git push origin v1.0.0
```
