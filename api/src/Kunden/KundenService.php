<?php
declare(strict_types=1);

namespace Plinth\Api\Kunden;

use PDO;
use Plinth\Api\Http\ApiException;

final class KundenService
{
    /** Ohne leicht verwechselbare Zeichen (0/O, 1/I/L). */
    private const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

    public function __construct(private PDO $db)
    {
    }

    /** 12 Zeichen (~59 Bit), gespeichert ohne Bindestriche. */
    public static function generateCode(): string
    {
        $code = '';
        for ($i = 0; $i < 12; $i++) {
            $code .= self::ALPHABET[random_int(0, strlen(self::ALPHABET) - 1)];
        }
        return $code;
    }

    /** Anzeigeform: ABCD-EFGH-JKMN */
    public static function formatCode(string $code): string
    {
        return implode('-', str_split($code, 4));
    }

    /** Akzeptiert Eingaben mit Leerzeichen, Bindestrichen und Kleinbuchstaben. */
    public static function normalizeCode(string $input): string
    {
        return (string) preg_replace('/[^A-Z0-9]/', '', strtoupper($input));
    }

    /** @return array{id:int,name:string,kundencode:string} */
    public function get(int $kundeId): array
    {
        $stmt = $this->db->prepare('SELECT id, name, kundencode FROM kunden WHERE id = ?');
        $stmt->execute([$kundeId]);
        $row = $stmt->fetch();
        if ($row === false) {
            throw ApiException::notFound();
        }
        $code = $row['kundencode'] ?? $this->rotateCode($kundeId);
        return ['id' => (int) $row['id'], 'name' => $row['name'], 'kundencode' => self::formatCode($code)];
    }

    /** Erzeugt einen neuen Kundencode. Bereits registrierte Geräte bleiben registriert. */
    public function rotateCode(int $kundeId): string
    {
        for ($try = 0; $try < 5; $try++) {
            $code = self::generateCode();
            try {
                $this->db->prepare('UPDATE kunden SET kundencode = ? WHERE id = ?')->execute([$code, $kundeId]);
                return $code;
            } catch (\PDOException $e) {
                if ($e->errorInfo[1] !== 1062) { // doppelter Schlüssel → neuer Versuch
                    throw $e;
                }
            }
        }
        throw new \RuntimeException('Kein eindeutiger Kundencode gefunden.');
    }

    /** @return int|null kunde_id eines aktiven Kunden zu diesem Code */
    public function findActiveByCode(string $code): ?int
    {
        $stmt = $this->db->prepare('SELECT id FROM kunden WHERE kundencode = ? AND aktiv = 1');
        $stmt->execute([self::normalizeCode($code)]);
        $id = $stmt->fetchColumn();
        return $id === false ? null : (int) $id;
    }
}
