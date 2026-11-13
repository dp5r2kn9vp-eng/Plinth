-- Zeitpunkt der serverseitigen SHA-256-Prüfung (bin/verify-files.php)
ALTER TABLE dateien ADD COLUMN geprueft_am DATETIME NULL AFTER sha256;
