<?php
declare(strict_types=1);

namespace Plinth\Api;

use PDO;
use Plinth\Api\Http\ApiException;

/**
 * Fester Zeitfenster-Zähler in der Datenbank (funktioniert auch auf Shared Hosting ohne Redis/APCu).
 * Wird für Login und später für die Geräte-Endpunkte genutzt.
 */
final class RateLimiter
{
    public function __construct(private PDO $db)
    {
    }

    /**
     * Zählt einen Treffer und wirft 429, wenn das Limit im Fenster überschritten ist.
     */
    public function hit(string $bucket, int $limit, int $windowSeconds): void
    {
        $key = hash('sha256', $bucket);

        // Ein einziges Statement, damit parallele Requests sauber zählen.
        // MySQL wertet die Zuweisungen von links nach rechts aus: hits nutzt noch das alte window_start.
        $this->db->prepare(
            'INSERT INTO rate_limits (bucket, hits, window_start) VALUES (:b, 1, UTC_TIMESTAMP())
             ON DUPLICATE KEY UPDATE
               hits = IF(window_start <= UTC_TIMESTAMP() - INTERVAL :w1 SECOND, 1, hits + 1),
               window_start = IF(window_start <= UTC_TIMESTAMP() - INTERVAL :w2 SECOND, UTC_TIMESTAMP(), window_start)'
        )->execute(['b' => $key, 'w1' => $windowSeconds, 'w2' => $windowSeconds]);

        $stmt = $this->db->prepare(
            'SELECT hits, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), window_start + INTERVAL :w SECOND) AS rest
             FROM rate_limits WHERE bucket = :b'
        );
        $stmt->execute(['b' => $key, 'w' => $windowSeconds]);
        $row = $stmt->fetch();

        if ($row !== false && (int) $row['hits'] > $limit) {
            throw ApiException::tooManyRequests(max(1, (int) $row['rest']));
        }
    }

    public function reset(string $bucket): void
    {
        $this->db->prepare('DELETE FROM rate_limits WHERE bucket = :b')->execute(['b' => hash('sha256', $bucket)]);
    }
}
