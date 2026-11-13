<?php
declare(strict_types=1);

namespace Plinth\Api\Geraete;

use PDO;
use Plinth\Api\Http\ApiException;
use Plinth\Api\Token;

final class GeraeteService
{
    public function __construct(private PDO $db)
    {
    }

    /** @return array{id:int,token:string} */
    public function register(int $kundeId, string $name, ?string $appVersion, string $ip): array
    {
        $token = Token::generate();
        $this->db->prepare(
            'INSERT INTO geraete (kunde_id, name, token_hash, registriert_am, zuletzt_gesehen_am, app_version, ip)
             VALUES (?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), ?, ?)'
        )->execute([$kundeId, $name, Token::hash($token), $appVersion, substr($ip, 0, 45)]);
        return ['id' => (int) $this->db->lastInsertId(), 'token' => $token];
    }

    /**
     * Gerät zum Token. Gesperrte Geräte oder Kunden: 403, damit der Player
     * "gesperrt" von "Token ungültig" unterscheiden und dem Techniker anzeigen kann.
     *
     * @return array<string,mixed>
     */
    public function authenticate(string $token, string $ip, ?string $appVersion): array
    {
        $stmt = $this->db->prepare(
            'SELECT g.*, k.aktiv AS kunde_aktiv FROM geraete g JOIN kunden k ON k.id = g.kunde_id WHERE g.token_hash = ?'
        );
        $stmt->execute([Token::hash($token)]);
        $device = $stmt->fetch();
        if ($device === false) {
            throw new ApiException(401, 'device_unknown', 'Gerät ist nicht registriert.');
        }
        if ($device['gesperrt'] || !$device['kunde_aktiv']) {
            throw new ApiException(403, 'device_blocked', 'Gerät ist gesperrt.');
        }
        $this->db->prepare(
            'UPDATE geraete SET zuletzt_gesehen_am = UTC_TIMESTAMP(), ip = ?, app_version = COALESCE(?, app_version) WHERE id = ?'
        )->execute([substr($ip, 0, 45), $appVersion, $device['id']]);
        return $device;
    }

    /** @return list<array<string,mixed>> */
    public function list(int $kundeId): array
    {
        $stmt = $this->db->prepare('SELECT * FROM geraete WHERE kunde_id = ? ORDER BY name, id');
        $stmt->execute([$kundeId]);
        return array_map([self::class, 'present'], $stmt->fetchAll());
    }

    /** @return array<string,mixed> */
    public function get(int $kundeId, int $id): array
    {
        $stmt = $this->db->prepare('SELECT * FROM geraete WHERE id = ? AND kunde_id = ?');
        $stmt->execute([$id, $kundeId]);
        $row = $stmt->fetch();
        if ($row === false) {
            throw ApiException::notFound('Gerät nicht gefunden.');
        }
        return self::present($row);
    }

    /** @param array{name?:string,gesperrt?:bool,projektId?:int|null} $changes */
    public function update(int $kundeId, int $id, array $changes): array
    {
        $this->get($kundeId, $id);
        if (array_key_exists('projektId', $changes) && $changes['projektId'] !== null) {
            $stmt = $this->db->prepare('SELECT 1 FROM projekte WHERE id = ? AND kunde_id = ?');
            $stmt->execute([$changes['projektId'], $kundeId]);
            if ($stmt->fetchColumn() === false) {
                throw ApiException::validation(['projektId' => 'Projekt gibt es nicht.']);
            }
        }
        $map = ['name' => 'name', 'gesperrt' => 'gesperrt', 'projektId' => 'projekt_id'];
        foreach ($changes as $key => $value) {
            $this->db->prepare("UPDATE geraete SET {$map[$key]} = ? WHERE id = ? AND kunde_id = ?")
                ->execute([is_bool($value) ? (int) $value : $value, $id, $kundeId]);
        }
        return $this->get($kundeId, $id);
    }

    public function delete(int $kundeId, int $id): void
    {
        $this->get($kundeId, $id);
        $this->db->prepare('DELETE FROM geraete WHERE id = ? AND kunde_id = ?')->execute([$id, $kundeId]);
    }

    /**
     * @param array<string,mixed> $row
     * @return array<string,mixed>
     */
    public static function present(array $row): array
    {
        $iso = static fn (?string $t) => $t === null ? null : str_replace(' ', 'T', $t) . 'Z';
        return [
            'id' => (int) $row['id'],
            'name' => $row['name'],
            'projektId' => $row['projekt_id'] === null ? null : (int) $row['projekt_id'],
            'gesperrt' => (bool) $row['gesperrt'],
            'registriertAm' => $iso($row['registriert_am']),
            'zuletztGesehenAm' => $iso($row['zuletzt_gesehen_am']),
            'geladeneRevision' => $row['geladene_revision'] === null ? null : (int) $row['geladene_revision'],
            'appVersion' => $row['app_version'],
        ];
    }
}
