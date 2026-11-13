<?php
declare(strict_types=1);

namespace Plinth\Api\Tests;

use PDO;
use PHPUnit\Framework\TestCase;
use Plinth\Api\App;
use Plinth\Api\Auth\SessionService;
use Plinth\Api\Config;
use Plinth\Api\Database;
use Plinth\Api\Http\Request;
use Plinth\Api\Http\Response;
use Plinth\Api\Logger;

/**
 * Testet die API im Prozess gegen eine echte MySQL/MariaDB-Testdatenbank.
 * Konfiguration über TEST_DB_* (siehe phpunit.xml.dist). Die Testdatenbank wird geleert!
 */
abstract class ApiTestCase extends TestCase
{
    protected static PDO $db;
    protected App $app;

    public static function setUpBeforeClass(): void
    {
        $config = self::config();
        self::$db = Database::connect($config);
        self::$db->exec('SET FOREIGN_KEY_CHECKS = 0');
        foreach (self::$db->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN) as $table) {
            self::$db->exec("DROP TABLE `{$table}`");
        }
        self::$db->exec('SET FOREIGN_KEY_CHECKS = 1');
        foreach (glob(dirname(__DIR__) . '/migrations/*.sql') as $file) {
            $sql = preg_replace('/^\s*--.*$/m', '', (string) file_get_contents($file));
            foreach (array_filter(array_map('trim', explode(';', $sql))) as $statement) {
                self::$db->exec($statement);
            }
        }
    }

    protected function setUp(): void
    {
        self::$db->exec('SET FOREIGN_KEY_CHECKS = 0');
        foreach (self::$db->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN) as $table) {
            self::$db->exec("DELETE FROM `{$table}`");
        }
        self::$db->exec('SET FOREIGN_KEY_CHECKS = 1');
        $this->app = new App(self::config(), new Logger(null), fn () => self::$db);
    }

    protected static function config(): Config
    {
        return Config::fromArray([
            'APP_URL' => 'https://plinth.example',
            'API_BASE_PATH' => '/api',
            'DB_HOST' => getenv('TEST_DB_HOST') ?: '127.0.0.1',
            'DB_PORT' => getenv('TEST_DB_PORT') ?: '3306',
            'DB_NAME' => getenv('TEST_DB_NAME') ?: 'plinth_test',
            'DB_USER' => getenv('TEST_DB_USER') ?: 'plinth',
            'DB_PASS' => getenv('TEST_DB_PASS') ?: '',
        ]);
    }

    protected function createUser(string $email, string $password, bool $aktiv = true, bool $kundeAktiv = true, ?int $kundeId = null): int
    {
        if ($kundeId === null) {
            self::$db->prepare('INSERT INTO kunden (name, aktiv) VALUES (?, ?)')->execute(['Testkunde', (int) $kundeAktiv]);
            $kundeId = (int) self::$db->lastInsertId();
        }
        self::$db->prepare('INSERT INTO benutzer (kunde_id, email, name, passwort_hash, aktiv) VALUES (?, ?, ?, ?, ?)')
            ->execute([$kundeId, $email, 'Test Benutzer', SessionService::hashPassword($password), (int) $aktiv]);
        return (int) self::$db->lastInsertId();
    }

    /**
     * @param array<string,mixed>|null $json
     * @param array<string,string> $headers
     * @param array<string,string> $cookies
     */
    protected function request(
        string $method,
        string $path,
        ?array $json = null,
        array $headers = [],
        array $cookies = [],
        string $ip = '203.0.113.5',
    ): Response {
        if ($json !== null) {
            $headers += ['content-type' => 'application/json'];
        }
        $query = [];
        parse_str((string) parse_url($path, PHP_URL_QUERY), $query);
        return $this->app->handle(new Request(
            $method,
            (string) parse_url($path, PHP_URL_PATH),
            $headers,
            $json === null ? '' : json_encode($json, JSON_THROW_ON_ERROR),
            $cookies,
            $query,
            $ip,
        ));
    }

    protected static function kundeIdOf(int $userId): int
    {
        return (int) self::$db->query("SELECT kunde_id FROM benutzer WHERE id = {$userId}")->fetchColumn();
    }

    /** Meldet einen neuen Benutzer an und liefert das Sitzungscookie. */
    protected function loginAs(string $email, ?int $kundeId = null): string
    {
        $this->createUser($email, 'passwort-fuer-tests', kundeId: $kundeId);
        $res = $this->request('POST', '/v1/auth/login', ['email' => $email, 'password' => 'passwort-fuer-tests']);
        return (string) self::sessionCookie($res);
    }

    /** @return array<string,mixed> */
    protected static function body(Response $response): array
    {
        return json_decode($response->body, true, 32, JSON_THROW_ON_ERROR);
    }

    protected static function sessionCookie(Response $response): ?string
    {
        foreach ($response->cookies as $cookie) {
            if (preg_match('/^plinth_session=([^;]*)/', $cookie, $m)) {
                return rawurldecode($m[1]);
            }
        }
        return null;
    }
}
