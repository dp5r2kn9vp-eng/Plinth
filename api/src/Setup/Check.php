<?php
declare(strict_types=1);

namespace Plinth\Api\Setup;

use PDO;
use Plinth\Api\Config;
use Plinth\Api\Database;
use Plinth\Api\Storage\S3Storage;
use Throwable;

/**
 * Prüft eine Installation: PHP, Erweiterungen, Konfiguration, Datenbank, Speicher.
 * Wird von bin/check.php (Kommandozeile) und pruefung.php (Browser) genutzt.
 */
final class Check
{
    /** @var list<array{status:string,text:string,hint:string}> */
    private array $lines = [];

    /** @return list<array{status:string,text:string,hint:string}> */
    public function run(): array
    {
        $this->lines = [];
        $this->add(PHP_VERSION_ID >= 80200, 'PHP ' . PHP_VERSION, 'PHP 8.2 oder neuer im Hoster-Menü einstellen.');
        foreach (['pdo_mysql', 'json', 'mbstring', 'curl', 'openssl'] as $ext) {
            $this->add(extension_loaded($ext), "Erweiterung {$ext}", "PHP-Erweiterung {$ext} aktivieren.");
        }
        defined('PASSWORD_ARGON2ID')
            ? $this->add(true, 'Argon2id verfügbar')
            : $this->note('Argon2id fehlt – Passwörter werden mit bcrypt gespeichert (sicher, später automatisch umgestellt)');

        $config = Config::load();
        $found = Config::envFile();
        $root = dirname(__DIR__, 3);
        $this->add($found !== null, 'Konfigurationsdatei: ' . ($found !== null ? str_replace($root . '/', '', $found) : 'nicht gefunden'), 'config/plinth.env anlegen (Vorlage: config/plinth.env.vorlage).');
        if ($found !== null && dirname($found) === $root) {
            $this->note('Die Konfiguration liegt direkt im Webroot – besser nach config/plinth.env verschieben (doppelt gesperrt).');
        }
        if ($found !== null && str_starts_with($found, $root . '/config/')) {
            $this->add(is_file($root . '/config/.htaccess'), 'Ordner config/ gesperrt (.htaccess vorhanden)', 'Datei config/.htaccess mit hochladen (versteckte Dateien im FTP-Programm anzeigen).');
        }
        foreach (['APP_URL', 'DB_NAME', 'DB_USER', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_KEY', 'S3_SECRET'] as $key) {
            $this->add($config->get($key) !== null, "{$key} gesetzt", "{$key} in plinth.env eintragen.");
        }
        $appUrl = $config->get('APP_URL');
        if ($appUrl !== null && !str_starts_with($appUrl, 'https://') && $config->get('APP_ENV', 'production') === 'production') {
            $this->note('APP_URL beginnt nicht mit https:// – im Betrieb HTTPS verwenden.');
        }

        try {
            $db = Database::connect($config);
            $this->add(true, 'Datenbankverbindung');
            $tables = $db->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
            $this->add(in_array('geraete', $tables, true), 'Tabellen angelegt (' . count($tables) . ')', 'datenbank.sql in phpMyAdmin importieren (oder php api/bin/migrate.php).');
            if (in_array('benutzer', $tables, true)) {
                $n = (int) $db->query('SELECT COUNT(*) FROM benutzer')->fetchColumn();
                $this->add($n > 0, "Benutzer vorhanden ({$n})", 'Ersten Benutzer im Formular unten auf der Prüfseite anlegen (oder per bin/create-user.php).');
            }
        } catch (Throwable $e) {
            $this->add(false, 'Datenbankverbindung', self::short($e));
        }

        try {
            $storage = S3Storage::fromConfig($config);
            $key = 'plinth-check/' . bin2hex(random_bytes(6)) . '.txt';
            $storage->client()->putObject(['Bucket' => $storage->bucket(), 'Key' => $key, 'Body' => 'ok']);
            $size = $storage->size($key);
            $storage->delete($key);
            $this->add($size === 2, 'Speicher: schreiben, lesen, löschen');
            $uploadId = $storage->createMultipartUpload('plinth-check/multipart.bin', 'application/octet-stream');
            $url = $storage->presignUploadPart('plinth-check/multipart.bin', $uploadId, 1, 600);
            $storage->abortMultipartUpload('plinth-check/multipart.bin', $uploadId);
            $this->add(str_starts_with($url, 'http'), 'Speicher: Multipart-Upload und signierte URLs');
        } catch (Throwable $e) {
            $this->add(false, 'Speicher erreichbar', self::short($e));
        }

        $logDir = dirname(__DIR__, 2) . '/storage/logs';
        @mkdir($logDir, 0775, true);
        $this->add(is_writable($logDir), 'Logordner beschreibbar (api/storage/logs)', 'Ordner api/storage/logs anlegen und Schreibrechte geben (775).');

        return $this->lines;
    }

    public function ok(): bool
    {
        foreach ($this->lines as $l) {
            if ($l['status'] === 'FEHLER') {
                return false;
            }
        }
        return true;
    }

    public function text(): string
    {
        $out = '';
        foreach ($this->lines as $l) {
            $out .= str_pad("[{$l['status']}]", 10) . $l['text'] . ($l['hint'] !== '' ? "\n          → {$l['hint']}" : '') . "\n";
        }
        return $out . ($this->ok() ? "\nAlles bereit.\n" : "\nBitte die Fehler oben beheben.\n");
    }

    private function add(bool $good, string $text, string $hint = ''): void
    {
        $this->lines[] = ['status' => $good ? 'OK' : 'FEHLER', 'text' => $text, 'hint' => $good ? '' : $hint];
    }

    private function note(string $text): void
    {
        $this->lines[] = ['status' => 'HINWEIS', 'text' => $text, 'hint' => ''];
    }

    /** Fehlermeldung ohne Zugangsdaten und ohne seitenlange SDK-Details */
    private static function short(Throwable $e): string
    {
        $msg = preg_replace('/(X-Amz-Credential|X-Amz-Signature|Authorization)=[^&\s]+/i', '$1=…', $e->getMessage());
        return mb_substr(trim((string) preg_replace('/\s+/', ' ', (string) $msg)), 0, 400);
    }
}
