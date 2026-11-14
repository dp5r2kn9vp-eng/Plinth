#!/usr/bin/env bash
# Baut das Upload-Paket für den Webspace (FTP/SFTP): dist/ftp/ und dist/plinth-ftp-<datum>.zip
# Inhalt von dist/ftp = Inhalt des Webroots (z. B. Ordner Plinth); NICHT-HOCHLADEN/ bleibt lokal.
# Voraussetzungen: PHP, Composer, zip
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist/ftp"
rm -rf "$OUT" && mkdir -p "$OUT/shared"

echo "→ API"
rsync -a --exclude tests --exclude vendor --exclude storage --exclude .phpunit.cache --exclude phpunit.xml.dist --exclude README.md "$ROOT/api/" "$OUT/api/"
(cd "$OUT/api" && composer install --no-dev --prefer-dist --optimize-autoloader --no-interaction --no-progress)
# Falls Composer aus Git installieren musste: Historie entfernen (spart Hunderte MB)
find "$OUT/api/vendor" -name .git -type d -prune -exec rm -rf {} +
mkdir -p "$OUT/api/storage/logs"

echo "→ Studio und gemeinsame Dateien"
rsync -a --exclude README.md "$ROOT/studio/" "$OUT/studio/"
rsync -a "$ROOT/shared/renderer" "$ROOT/shared/schemas" "$OUT/shared/"

echo "→ Schutz und Vorlagen"
cp "$ROOT/tools/deploy/root.htaccess" "$OUT/.htaccess"
cp "$ROOT/tools/deploy/index.html" "$OUT/index.html"
cp "$ROOT/tools/deploy/pruefung.php" "$OUT/pruefung.php"
cp "$ROOT/tools/deploy/cron.php" "$OUT/cron.php"
mkdir -p "$OUT/config" "$OUT/NICHT-HOCHLADEN"
cp "$ROOT/tools/deploy/config.htaccess" "$OUT/config/.htaccess"
cp "$ROOT/.env.example" "$OUT/config/plinth.env.vorlage"
cp "$ROOT/tools/deploy/ANLEITUNG.md" "$OUT/NICHT-HOCHLADEN/ANLEITUNG.md"

# Alle Migrationen als eine SQL-Datei (für phpMyAdmin, falls kein SSH vorhanden)
{
  echo "-- Plinth: komplettes Datenbankschema. In phpMyAdmin in die leere Datenbank importieren."
  echo "SET NAMES utf8mb4;"
  echo "CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(190) NOT NULL PRIMARY KEY, angewendet_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;"
  for f in "$ROOT"/api/migrations/*.sql; do
    echo; echo "-- $(basename "$f")"; cat "$f"
    echo; echo "INSERT INTO schema_migrations (name) VALUES ('$(basename "$f")');"
  done
} > "$OUT/NICHT-HOCHLADEN/datenbank.sql"

ZIP="$ROOT/dist/plinth-ftp-$(date +%Y-%m-%d).zip"
rm -f "$ZIP"
(cd "$OUT" && zip -qr "$ZIP" .)
echo "Fertig: $OUT ($(du -sh "$OUT" | cut -f1)), $ZIP ($(du -h "$ZIP" | cut -f1))"
