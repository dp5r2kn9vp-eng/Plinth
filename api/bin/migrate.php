<?php
declare(strict_types=1);

// Führt alle noch nicht angewendeten Migrationen aus migrations/*.sql aus.
// Nutzung: php bin/migrate.php

use Plinth\Api\Config;
use Plinth\Api\Database;

require dirname(__DIR__) . '/vendor/autoload.php';

$db = Database::connect(Config::load());
$db->exec('CREATE TABLE IF NOT EXISTS schema_migrations (
    name VARCHAR(190) NOT NULL PRIMARY KEY,
    angewendet_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');

$done = $db->query('SELECT name FROM schema_migrations')->fetchAll(PDO::FETCH_COLUMN);
$files = glob(dirname(__DIR__) . '/migrations/*.sql') ?: [];
sort($files);

$count = 0;
foreach ($files as $file) {
    $name = basename($file);
    if (in_array($name, $done, true)) {
        continue;
    }
    // MySQL committet DDL automatisch; daher Statement für Statement ausführen.
    $sql = preg_replace('/^\s*--.*$/m', '', (string) file_get_contents($file));
    foreach (array_filter(array_map('trim', explode(';', $sql))) as $statement) {
        $db->exec($statement);
    }
    $db->prepare('INSERT INTO schema_migrations (name) VALUES (?)')->execute([$name]);
    echo "angewendet: {$name}\n";
    $count++;
}
echo $count === 0 ? "Datenbank ist aktuell.\n" : "{$count} Migration(en) angewendet.\n";
