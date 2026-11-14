<?php
declare(strict_types=1);

// Prüft die Installation: PHP, Erweiterungen, Konfiguration, Datenbank, Speicher.
// Nutzung: php bin/check.php   (per SSH oder einmalig als Cronjob)
// Im Browser: pruefung.php im Webroot (siehe Anleitung)

if (!is_file(dirname(__DIR__) . '/vendor/autoload.php')) {
    echo "[FEHLER]  vendor/ fehlt – Ordner api/vendor vollständig hochladen.\n";
    exit(1);
}
require dirname(__DIR__) . '/vendor/autoload.php';

$check = new Plinth\Api\Setup\Check();
$check->run();
echo $check->text();
exit($check->ok() ? 0 : 1);
