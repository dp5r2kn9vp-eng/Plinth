<?php
declare(strict_types=1);

namespace Plinth\Api\Player;

use PDO;
use Plinth\Api\Dateien\DateienService;
use Plinth\Api\Storage\Storage;

/** Was ein Gerät abspielen soll. */
final class PlayerService
{
    public function __construct(private PDO $db, private Storage $storage, private int $downloadTtl)
    {
    }

    /** Projekt des Geräts: zugewiesen oder das erste Projekt des Kunden. */
    public function projektId(array $device): ?int
    {
        if ($device['projekt_id'] !== null) {
            return (int) $device['projekt_id'];
        }
        $stmt = $this->db->prepare('SELECT MIN(id) FROM projekte WHERE kunde_id = ?');
        $stmt->execute([$device['kunde_id']]);
        $id = $stmt->fetchColumn();
        return $id === null || $id === false ? null : (int) $id;
    }

    public function currentRevision(?int $projektId): ?int
    {
        if ($projektId === null) {
            return null;
        }
        $stmt = $this->db->prepare("SELECT MAX(nummer) FROM revisionen WHERE projekt_id = ? AND status = 'aktiv'");
        $stmt->execute([$projektId]);
        $n = $stmt->fetchColumn();
        return $n === null || $n === false ? null : (int) $n;
    }

    /**
     * Manifest plus zeitlich begrenzte Download-Links (Datei-ID => URL).
     *
     * @return array{projektId:int,manifest:array<string,mixed>,downloads:array<string,string>,gueltigBis:string}|null
     */
    public function manifest(array $device, ?int $nummer = null): ?array
    {
        $projektId = $this->projektId($device);
        $nummer ??= $this->currentRevision($projektId);
        if ($nummer === null) {
            return null;
        }
        $stmt = $this->db->prepare("SELECT manifest FROM revisionen WHERE projekt_id = ? AND nummer = ? AND status = 'aktiv'");
        $stmt->execute([$projektId, $nummer]);
        $json = $stmt->fetchColumn();
        if ($json === false) {
            return null;
        }
        $manifest = json_decode($json, true, 64, JSON_THROW_ON_ERROR);

        $downloads = [];
        foreach ($manifest['files'] as $file) {
            $id = (int) substr($file['id'], 1);
            $stmt = $this->db->prepare('SELECT speicher_schluessel FROM dateien WHERE id = ? AND kunde_id = ?');
            $stmt->execute([$id, $device['kunde_id']]);
            $key = $stmt->fetchColumn();
            if ($key !== false) {
                $downloads[$file['id']] = $this->storage->presignDownload($key, $this->downloadTtl);
            }
        }
        return [
            'projektId' => $projektId,
            'manifest' => $manifest,
            'downloads' => $downloads,
            'gueltigBis' => gmdate('Y-m-d\TH:i:s\Z', time() + $this->downloadTtl),
        ];
    }

    public function reportStatus(int $deviceId, ?int $geladeneRevision): void
    {
        $this->db->prepare('UPDATE geraete SET geladene_revision = ? WHERE id = ?')->execute([$geladeneRevision, $deviceId]);
    }

    public static function mediaExtension(string $mime): string
    {
        return DateienService::ERLAUBT[$mime];
    }
}
