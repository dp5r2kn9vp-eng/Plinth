<?php
declare(strict_types=1);

// Prüft SHA-256 hochgeladener Dateien serverseitig (streamt aus dem Speicher, nicht im Web-Request).
// Cronjob, z. B. alle 10 Minuten. Bei Hostern, deren Cronjobs nur URLs aufrufen: cron.php im Webroot.
// Nutzung: php bin/verify-files.php [--limit=5]

use Plinth\Api\Config;
use Plinth\Api\Database;
use Plinth\Api\Setup\VerifyFiles;
use Plinth\Api\Storage\S3Storage;

require dirname(__DIR__) . '/vendor/autoload.php';

$lock = fopen(sys_get_temp_dir() . '/plinth-verify.lock', 'c');
if (!flock($lock, LOCK_EX | LOCK_NB)) {
    echo "Läuft bereits.\n";
    exit(0);
}
$config = Config::load();
$limit = max(1, (int) (getopt('', ['limit:'])['limit'] ?? 5));
$lines = (new VerifyFiles(Database::connect($config), S3Storage::fromConfig($config)))->run($limit);
echo implode("\n", $lines) . "\n";
