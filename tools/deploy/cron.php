<?php
declare(strict_types=1);

// Plinth – Dateiprüfung für Hoster, deren Cronjobs eine URL aufrufen (z. B. all-inkl).
// Freischalten: in plinth.env CRON_TOKEN=<zufälliger Text, mind. 20 Zeichen> eintragen.
// Cronjob-URL: https://<domain>/cron.php?token=<derselbe Text>   (alle 10 Minuten)

header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');

require __DIR__ . '/api/vendor/autoload.php';

$config = Plinth\Api\Config::load();
$expected = (string) $config->get('CRON_TOKEN', '');
if (strlen($expected) < 20 || !hash_equals($expected, (string) ($_GET['token'] ?? ''))) {
    usleep(500000);
    http_response_code(403);
    exit("Nicht erlaubt.\n");
}

ignore_user_abort(true);
@set_time_limit(300);
$lock = fopen(sys_get_temp_dir() . '/plinth-verify.lock', 'c');
if (!flock($lock, LOCK_EX | LOCK_NB)) {
    exit("Läuft bereits.\n");
}
$check = new Plinth\Api\Setup\VerifyFiles(
    Plinth\Api\Database::connect($config),
    Plinth\Api\Storage\S3Storage::fromConfig($config),
);
// Webserver brechen lange Anfragen ab: höchstens 4 Minuten arbeiten, Rest beim nächsten Aufruf
echo implode("\n", $check->run(3, 240)) . "\n";
