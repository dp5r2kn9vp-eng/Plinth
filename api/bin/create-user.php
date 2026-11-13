<?php
declare(strict_types=1);

// Legt einen Designer-Benutzer an (und bei Bedarf den Kunden).
// Nutzung: php bin/create-user.php --kunde="Musterfirma" --email=a@b.de --name="Max Muster"
// Das Passwort wird interaktiv abgefragt (oder per Umgebungsvariable PLINTH_PASSWORD übergeben).

use Plinth\Api\Auth\SessionService;
use Plinth\Api\Config;
use Plinth\Api\Database;

require dirname(__DIR__) . '/vendor/autoload.php';

$opt = getopt('', ['kunde:', 'email:', 'name:']);
foreach (['kunde', 'email', 'name'] as $key) {
    if (empty($opt[$key])) {
        fwrite(STDERR, "Fehlt: --{$key}\nNutzung: php bin/create-user.php --kunde=NAME --email=E-MAIL --name=NAME\n");
        exit(1);
    }
}
$email = mb_strtolower(trim($opt['email']));
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    fwrite(STDERR, "Ungültige E-Mail.\n");
    exit(1);
}

$password = getenv('PLINTH_PASSWORD') ?: null;
if ($password === null) {
    fwrite(STDOUT, 'Passwort: ');
    system('stty -echo 2>/dev/null');
    $password = rtrim((string) fgets(STDIN), "\r\n");
    system('stty echo 2>/dev/null');
    fwrite(STDOUT, "\n");
}
if (strlen($password) < 10) {
    fwrite(STDERR, "Passwort muss mindestens 10 Zeichen haben.\n");
    exit(1);
}

$db = Database::connect(Config::load());
$stmt = $db->prepare('SELECT id FROM kunden WHERE name = ?');
$stmt->execute([$opt['kunde']]);
$kundeId = $stmt->fetchColumn();
if ($kundeId === false) {
    $db->prepare('INSERT INTO kunden (name) VALUES (?)')->execute([$opt['kunde']]);
    $kundeId = $db->lastInsertId();
    echo "Kunde angelegt: {$opt['kunde']} (#{$kundeId})\n";
}

$db->prepare('INSERT INTO benutzer (kunde_id, email, name, passwort_hash) VALUES (?, ?, ?, ?)')
    ->execute([$kundeId, $email, $opt['name'], SessionService::hashPassword($password)]);
echo "Benutzer angelegt: {$email} (#{$db->lastInsertId()})\n";
