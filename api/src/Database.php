<?php
declare(strict_types=1);

namespace Plinth\Api;

use PDO;

final class Database
{
    public static function connect(Config $config): PDO
    {
        $dsn = sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
            $config->get('DB_HOST', 'localhost'),
            $config->int('DB_PORT', 3306),
            $config->require('DB_NAME'),
        );
        $pdo = new PDO($dsn, $config->require('DB_USER'), $config->get('DB_PASS', ''), [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        // Alle Zeitstempel in UTC.
        $pdo->exec("SET time_zone = '+00:00'");
        return $pdo;
    }
}
