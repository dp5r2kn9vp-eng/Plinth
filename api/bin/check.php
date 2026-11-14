<?php
declare(strict_types=1);

// Prüft die Installation: PHP, Erweiterungen, Konfiguration, Datenbank, Speicher.
// Nutzung: php bin/check.php   (per SSH oder einmalig als Cronjob)

$ok = true;
function line(bool $good, string $text, string $hint = ''): void
{
    global $ok;
    $ok = $ok && $good;
    echo ($good ? '[OK]     ' : '[FEHLER] ') . $text . ($good || $hint === '' ? '' : "\n         → {$hint}") . "\n";
}

line(PHP_VERSION_ID >= 80200, 'PHP ' . PHP_VERSION, 'PHP 8.2 oder neuer im Hoster-Menü einstellen.');
foreach (['pdo_mysql', 'json', 'mbstring', 'curl', 'openssl'] as $ext) {
    line(extension_loaded($ext), "Erweiterung {$ext}", "PHP-Erweiterung {$ext} aktivieren.");
}
echo defined('PASSWORD_ARGON2ID') ? "[OK]     Argon2id verfügbar\n" : "[HINWEIS] Argon2id fehlt – Passwörter werden mit bcrypt gespeichert (sicher, später automatisch umgestellt)\n";

if (!is_file(dirname(__DIR__) . '/vendor/autoload.php')) {
    line(false, 'vendor/ vorhanden', 'Ordner api/vendor vollständig hochladen.');
    exit(1);
}
require dirname(__DIR__) . '/vendor/autoload.php';

$config = Plinth\Api\Config::load();
$found = (new ReflectionMethod(Plinth\Api\Config::class, 'findEnvFile'))->invoke(null);
line($found !== null, 'Konfigurationsdatei: ' . ($found ?? 'nicht gefunden'), 'plinth.env eine Ebene über dem Webroot anlegen (Vorlage: plinth.env.vorlage).');
if ($found !== null && str_ends_with($found, '/.env')) {
    echo "[HINWEIS] .env liegt im Webroot – nur durch .htaccess geschützt. Besser: als plinth.env eine Ebene höher ablegen.\n";
}
foreach (['APP_URL', 'DB_NAME', 'DB_USER', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_KEY', 'S3_SECRET'] as $key) {
    line($config->get($key) !== null, "{$key} gesetzt", "{$key} in plinth.env eintragen.");
}

try {
    $db = Plinth\Api\Database::connect($config);
    line(true, 'Datenbankverbindung');
    $tables = $db->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
    line(in_array('geraete', $tables, true), 'Tabellen angelegt (' . count($tables) . ')', 'php bin/migrate.php ausführen oder datenbank.sql in phpMyAdmin importieren.');
    if (in_array('benutzer', $tables, true)) {
        $n = (int) $db->query('SELECT COUNT(*) FROM benutzer')->fetchColumn();
        line($n > 0, "Benutzer vorhanden ({$n})", 'Ersten Benutzer mit bin/create-user.php anlegen.');
    }
} catch (Throwable $e) {
    line(false, 'Datenbankverbindung', $e->getMessage());
}

try {
    $storage = Plinth\Api\Storage\S3Storage::fromConfig($config);
    $key = 'plinth-check/' . bin2hex(random_bytes(6)) . '.txt';
    $storage->client()->putObject(['Bucket' => $storage->bucket(), 'Key' => $key, 'Body' => 'ok']);
    $size = $storage->size($key);
    $storage->delete($key);
    line($size === 2, 'Speicher: schreiben, lesen, löschen');
    $uploadId = $storage->createMultipartUpload('plinth-check/multipart.bin', 'application/octet-stream');
    $url = $storage->presignUploadPart('plinth-check/multipart.bin', $uploadId, 1, 600);
    $storage->abortMultipartUpload('plinth-check/multipart.bin', $uploadId);
    line(str_starts_with($url, 'https://') || str_starts_with($url, 'http://'), 'Speicher: Multipart-Upload und signierte URLs');
} catch (Throwable $e) {
    line(false, 'Speicher erreichbar', $e->getMessage());
}

echo $ok ? "\nAlles bereit.\n" : "\nBitte die Fehler oben beheben.\n";
exit($ok ? 0 : 1);
