<?php
declare(strict_types=1);

// Testdaten für Entwicklung und Abnahme: Kunde, Benutzer, Projekt mit Start-Entwurf.
// Nutzung: php bin/seed-dev.php   (verweigert APP_ENV=production)
// Passwort: PLINTH_PASSWORD oder Standard "Demo-Passwort-2026"

use Plinth\Api\Auth\SessionService;
use Plinth\Api\Config;
use Plinth\Api\Database;
use Plinth\Api\Kunden\KundenService;

require dirname(__DIR__) . '/vendor/autoload.php';

$config = Config::load();
if ($config->get('APP_ENV', 'production') === 'production') {
    fwrite(STDERR, "Abgebrochen: APP_ENV ist production. Für Testdaten APP_ENV=development setzen.\n");
    exit(1);
}
$db = Database::connect($config);
$password = getenv('PLINTH_PASSWORD') ?: 'Demo-Passwort-2026';

$kunden = [
    ['Testkunde Museum', 'demo@plinth.test', 'Demo Benutzer', 'landscape'],
    ['Testkunde Praxis', 'praxis@plinth.test', 'Praxis Team', 'portrait'],
];

foreach ($kunden as [$kundeName, $email, $name, $ausrichtung]) {
    $stmt = $db->prepare('SELECT id FROM benutzer WHERE email = ?');
    $stmt->execute([$email]);
    if ($stmt->fetchColumn() !== false) {
        echo "vorhanden: {$email}\n";
        continue;
    }
    $code = KundenService::generateCode();
    $db->prepare('INSERT INTO kunden (name, kundencode) VALUES (?, ?)')->execute([$kundeName, $code]);
    $kundeId = (int) $db->lastInsertId();
    $db->prepare('INSERT INTO benutzer (kunde_id, email, name, passwort_hash) VALUES (?, ?, ?, ?)')
        ->execute([$kundeId, $email, $name, SessionService::hashPassword($password)]);
    $db->prepare('INSERT INTO projekte (kunde_id, name, ausrichtung) VALUES (?, ?, ?)')
        ->execute([$kundeId, 'Hauptbildschirm', $ausrichtung]);
    $projektId = (int) $db->lastInsertId();

    [$w, $h] = $ausrichtung === 'portrait' ? [1080, 1920] : [1920, 1080];
    $layout = [
        'schemaVersion' => 1,
        'format' => ['orientation' => $ausrichtung, 'width' => $w, 'height' => $h],
        'idleTimeoutSeconds' => 120,
        'pages' => [[
            'id' => 'home',
            'name' => 'Startseite',
            'background' => ['color' => '#0e1116'],
            'elements' => [[
                'id' => 'titel', 'type' => 'text', 'x' => 100, 'y' => 100, 'w' => $w - 200, 'h' => 160,
                'text' => "Willkommen bei {$kundeName}",
                'style' => ['fontSize' => 80, 'fontWeight' => 700, 'color' => '#ffffff'],
            ]],
        ]],
        'videoPage' => ['background' => '#000000', 'header' => ['height' => 110, 'background' => '#151a22', 'color' => '#ffffff', 'backLabel' => 'Zurück']],
    ];
    $db->prepare('INSERT INTO entwuerfe (projekt_id, layout) VALUES (?, ?)')
        ->execute([$projektId, json_encode($layout, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);

    echo "angelegt: {$kundeName} – {$email} – Kundencode " . KundenService::formatCode($code) . "\n";
}
echo "Passwort für alle Testbenutzer: " . (getenv('PLINTH_PASSWORD') ? '(aus PLINTH_PASSWORD)' : $password) . "\n";
