<?php
declare(strict_types=1);

// Prüft SHA-256 hochgeladener Dateien serverseitig (streamt aus dem Speicher, nicht im Web-Request).
// Für einen Cronjob gedacht, z. B. alle 10 Minuten. Abweichung → Status "fehler".
// Nutzung: php bin/verify-files.php [--limit=5]

use Plinth\Api\Config;
use Plinth\Api\Database;
use Plinth\Api\Storage\S3Storage;

require dirname(__DIR__) . '/vendor/autoload.php';

$config = Config::load();
$db = Database::connect($config);
$storage = S3Storage::fromConfig($config);
$limit = max(1, (int) (getopt('', ['limit:'])['limit'] ?? 5));

// Sperre gegen parallele Läufe
$lock = fopen(sys_get_temp_dir() . '/plinth-verify.lock', 'c');
if (!flock($lock, LOCK_EX | LOCK_NB)) {
    echo "Läuft bereits.\n";
    exit(0);
}

$rows = $db->query("SELECT id, speicher_schluessel, sha256, groesse FROM dateien
                    WHERE status = 'fertig' AND geprueft_am IS NULL ORDER BY id LIMIT {$limit}")->fetchAll();
foreach ($rows as $row) {
    $start = microtime(true);
    $stream = $storage->readStream($row['speicher_schluessel']);
    $ctx = hash_init('sha256');
    $bytes = hash_update_stream($ctx, $stream);
    fclose($stream);
    $sha = hash_final($ctx);

    if ($sha === $row['sha256'] && $bytes === (int) $row['groesse']) {
        $db->prepare('UPDATE dateien SET geprueft_am = UTC_TIMESTAMP() WHERE id = ?')->execute([$row['id']]);
        printf("ok      #%d (%.1f s)\n", $row['id'], microtime(true) - $start);
    } else {
        $db->prepare("UPDATE dateien SET status = 'fehler', geprueft_am = UTC_TIMESTAMP() WHERE id = ?")->execute([$row['id']]);
        printf("FEHLER  #%d: erwartet %s, berechnet %s\n", $row['id'], $row['sha256'], $sha);
    }
}
echo count($rows) . " Datei(en) geprüft.\n";
