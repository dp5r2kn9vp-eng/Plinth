<?php
declare(strict_types=1);

namespace Plinth\Api\Setup;

use PDO;
use Plinth\Api\Storage\Storage;

/**
 * Prüft SHA-256 hochgeladener Dateien serverseitig (streamt aus dem Speicher).
 * Abweichung → Status "fehler". Genutzt von bin/verify-files.php und cron.php.
 */
final class VerifyFiles
{
    public function __construct(private PDO $db, private Storage $storage)
    {
    }

    /**
     * @param int $limit       höchstens so viele Dateien
     * @param int $maxSeconds  danach keine weitere Datei beginnen (Webserver-Zeitlimits)
     * @return list<string> Protokollzeilen
     */
    public function run(int $limit, int $maxSeconds = 0): array
    {
        $start = microtime(true);
        $log = [];
        $rows = $this->db->query("SELECT id, speicher_schluessel, sha256, groesse FROM dateien
                                  WHERE status = 'fertig' AND geprueft_am IS NULL ORDER BY id LIMIT " . max(1, $limit))->fetchAll();
        foreach ($rows as $row) {
            if ($maxSeconds > 0 && microtime(true) - $start > $maxSeconds) {
                $log[] = 'Zeitlimit erreicht – Rest beim nächsten Lauf.';
                break;
            }
            $t = microtime(true);
            $stream = $this->storage->readStream($row['speicher_schluessel']);
            $ctx = hash_init('sha256');
            $bytes = hash_update_stream($ctx, $stream);
            fclose($stream);
            $sha = hash_final($ctx);

            if ($sha === $row['sha256'] && $bytes === (int) $row['groesse']) {
                $this->db->prepare('UPDATE dateien SET geprueft_am = UTC_TIMESTAMP() WHERE id = ?')->execute([$row['id']]);
                $log[] = sprintf('ok      #%d (%.1f s)', $row['id'], microtime(true) - $t);
            } else {
                $this->db->prepare("UPDATE dateien SET status = 'fehler', geprueft_am = UTC_TIMESTAMP() WHERE id = ?")->execute([$row['id']]);
                $log[] = sprintf('FEHLER  #%d: erwartet %s, berechnet %s', $row['id'], $row['sha256'], $sha);
            }
        }
        $log[] = count($rows) . ' Datei(en) zur Prüfung ausgewählt.';
        return $log;
    }
}
