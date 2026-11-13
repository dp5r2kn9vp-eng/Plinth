<?php
declare(strict_types=1);

namespace Plinth\Api\Dateien;

use PDO;
use Plinth\Api\Http\ApiException;
use Plinth\Api\Storage\Storage;

/**
 * Medienbibliothek und Multipart-Uploads.
 * Der Browser lädt direkt in den Speicher; die API vergibt nur signierte Teil-URLs
 * und prüft nach dem Abschluss Größe und (optional pro Teil) SHA-256.
 */
final class DateienService
{
    public const ERLAUBT = [
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'image/webp' => 'webp',
        'video/mp4' => 'mp4',
        'video/webm' => 'webm',
    ];

    private const MIN_TEIL = 8 * 1024 * 1024;   // 8 MiB (S3 verlangt mind. 5 MiB außer beim letzten Teil)
    private const MAX_TEILE = 10000;            // S3-Grenze
    private const URL_TTL = 3600;

    public function __construct(
        private PDO $db,
        private Storage $storage,
        private int $maxBytes,
    ) {
    }

    public static function teilGroesse(int $groesse): int
    {
        $mib = 1024 * 1024;
        $noetig = (int) ceil($groesse / self::MAX_TEILE);
        return max(self::MIN_TEIL, (int) ceil($noetig / $mib) * $mib);
    }

    public static function teileAnzahl(int $groesse): int
    {
        return max(1, (int) ceil($groesse / self::teilGroesse($groesse)));
    }

    /** @return array<string,mixed> */
    public function startUpload(int $kundeId, int $userId, string $name, string $mime, int $groesse): array
    {
        $errors = [];
        if ($name === '' || mb_strlen($name) > 255) {
            $errors['name'] = 'Dateiname fehlt oder ist zu lang.';
        }
        if (!isset(self::ERLAUBT[$mime])) {
            $errors['mime'] = 'Erlaubt sind JPEG, PNG, WebP, MP4 und WebM.';
        }
        if ($groesse < 1 || $groesse > $this->maxBytes) {
            $errors['groesse'] = sprintf('Größe muss zwischen 1 Byte und %.1f GB liegen.', $this->maxBytes / 1e9);
        }
        if ($errors !== []) {
            throw ApiException::validation($errors);
        }

        $key = sprintf('kunden/%d/%s.%s', $kundeId, bin2hex(random_bytes(16)), self::ERLAUBT[$mime]);
        $uploadId = $this->storage->createMultipartUpload($key, $mime);

        $this->db->prepare(
            'INSERT INTO dateien (kunde_id, name, mime, groesse, speicher_schluessel, status, upload_id, erstellt_am, erstellt_von)
             VALUES (?, ?, ?, ?, ?, \'upload\', ?, UTC_TIMESTAMP(), ?)'
        )->execute([$kundeId, $name, $mime, $groesse, $key, $uploadId, $userId]);

        return $this->uploadInfo($this->row($kundeId, (int) $this->db->lastInsertId()));
    }

    /**
     * Stand eines laufenden Uploads inkl. bereits hochgeladener Teile (Wiederaufnahme).
     *
     * @return array<string,mixed>
     */
    public function uploadStatus(int $kundeId, int $id): array
    {
        $row = $this->uploadRow($kundeId, $id);
        $info = $this->uploadInfo($row);
        $info['upload']['fertigeTeile'] = $this->storage->listParts($row['speicher_schluessel'], $row['upload_id']);
        return $info;
    }

    /**
     * @param list<int> $nummern
     * @param array<string,string> $pruefsummen Teilnummer => SHA-256 (Base64)
     * @return array<string,string> Teilnummer => URL
     */
    public function teilUrls(int $kundeId, int $id, array $nummern, array $pruefsummen): array
    {
        $row = $this->uploadRow($kundeId, $id);
        $anzahl = self::teileAnzahl((int) $row['groesse']);
        if ($nummern === [] || count($nummern) > 100) {
            throw ApiException::validation(['teile' => 'Zwischen 1 und 100 Teilnummern angeben.']);
        }
        $urls = [];
        foreach ($nummern as $n) {
            if (!is_int($n) || $n < 1 || $n > $anzahl) {
                throw ApiException::validation(['teile' => "Teilnummern von 1 bis {$anzahl}."]);
            }
            $sum = $pruefsummen[(string) $n] ?? null;
            if ($sum !== null && !preg_match('#^[A-Za-z0-9+/]{43}=$#', $sum)) {
                throw ApiException::validation(['pruefsummen' => 'SHA-256 als Base64 angeben.']);
            }
            $urls[(string) $n] = $this->storage->presignUploadPart($row['speicher_schluessel'], $row['upload_id'], $n, self::URL_TTL, $sum);
        }
        return $urls;
    }

    /**
     * @param list<array{nummer:int,etag:string}> $teile
     * @return array<string,mixed>
     */
    public function abschliessen(int $kundeId, int $id, array $teile, string $sha256): array
    {
        $row = $this->uploadRow($kundeId, $id);
        $anzahl = self::teileAnzahl((int) $row['groesse']);

        if (!preg_match('/^[a-f0-9]{64}$/', $sha256)) {
            throw ApiException::validation(['sha256' => 'SHA-256 der ganzen Datei als Hex angeben.']);
        }
        $nummern = array_map(fn ($t) => $t['nummer'], $teile);
        sort($nummern);
        if ($nummern !== range(1, $anzahl)) {
            throw ApiException::validation(['teile' => "Es müssen genau die Teile 1 bis {$anzahl} angegeben werden."]);
        }

        $key = $row['speicher_schluessel'];
        try {
            $this->storage->completeMultipartUpload($key, $row['upload_id'], $teile);
        } catch (\Throwable $e) {
            throw new ApiException(409, 'upload_incomplete', 'Upload konnte nicht abgeschlossen werden. Fehlende Teile erneut hochladen.');
        }

        $size = $this->storage->size($key);
        if ($size !== (int) $row['groesse']) {
            $this->storage->delete($key);
            $this->db->prepare("UPDATE dateien SET status = 'fehler', upload_id = NULL WHERE id = ?")->execute([$id]);
            throw new ApiException(422, 'size_mismatch', sprintf(
                'Hochgeladene Größe (%s Bytes) passt nicht zur angekündigten (%s Bytes).',
                $size ?? 0,
                $row['groesse'],
            ));
        }

        $this->db->prepare("UPDATE dateien SET status = 'fertig', sha256 = ?, upload_id = NULL WHERE id = ?")
            ->execute([$sha256, $id]);
        return $this->present($this->row($kundeId, $id));
    }

    public function abbrechen(int $kundeId, int $id): void
    {
        $row = $this->uploadRow($kundeId, $id);
        $this->storage->abortMultipartUpload($row['speicher_schluessel'], $row['upload_id']);
        $this->db->prepare('DELETE FROM dateien WHERE id = ?')->execute([$id]);
    }

    /** @return list<array<string,mixed>> */
    public function list(int $kundeId): array
    {
        $stmt = $this->db->prepare(
            "SELECT * FROM dateien WHERE kunde_id = ? AND status = 'fertig' AND geloescht_am IS NULL ORDER BY erstellt_am DESC, id DESC"
        );
        $stmt->execute([$kundeId]);
        return array_map(fn ($r) => $this->present($r, true), $stmt->fetchAll());
    }

    /** @return array<string,mixed> */
    public function get(int $kundeId, int $id): array
    {
        return $this->present($this->row($kundeId, $id), true);
    }

    /**
     * Metadaten, die der Browser ermittelt (Abmessungen, Dauer, Standbild).
     *
     * @param array<string,mixed> $data
     * @return array<string,mixed>
     */
    public function update(int $kundeId, int $id, array $data): array
    {
        $row = $this->row($kundeId, $id);
        $set = [];
        $errors = [];
        if (array_key_exists('name', $data)) {
            is_string($data['name']) && trim($data['name']) !== '' && mb_strlen($data['name']) <= 255
                ? $set['name'] = trim($data['name']) : $errors['name'] = 'Ungültiger Name.';
        }
        foreach (['breite', 'hoehe'] as $k) {
            if (array_key_exists($k, $data)) {
                is_int($data[$k]) && $data[$k] > 0 && $data[$k] < 100000 ? $set[$k] = $data[$k] : $errors[$k] = 'Positive ganze Zahl.';
            }
        }
        if (array_key_exists('dauerSekunden', $data)) {
            is_numeric($data['dauerSekunden']) && $data['dauerSekunden'] >= 0
                ? $set['dauer_sekunden'] = (float) $data['dauerSekunden'] : $errors['dauerSekunden'] = 'Zahl ≥ 0.';
        }
        if (array_key_exists('vorschauDateiId', $data)) {
            $vid = $data['vorschauDateiId'];
            if ($vid === null) {
                $set['vorschau_datei_id'] = null;
            } elseif (!is_int($vid) || !str_starts_with($row['mime'], 'video/')) {
                $errors['vorschauDateiId'] = 'Nur für Videos, als Datei-ID.';
            } else {
                $v = $this->rowOrNull($kundeId, $vid);
                $v !== null && $v['status'] === 'fertig' && str_starts_with($v['mime'], 'image/')
                    ? $set['vorschau_datei_id'] = $vid : $errors['vorschauDateiId'] = 'Muss ein eigenes, fertiges Bild sein.';
            }
        }
        if ($errors !== []) {
            throw ApiException::validation($errors);
        }
        foreach ($set as $col => $value) {
            $this->db->prepare("UPDATE dateien SET {$col} = ? WHERE id = ?")->execute([$value, $id]);
        }
        return $this->get($kundeId, $id);
    }

    /** Aus der Bibliothek entfernen. Der Inhalt bleibt, solange veröffentlichte Revisionen ihn brauchen. */
    public function delete(int $kundeId, int $id): void
    {
        $this->row($kundeId, $id);
        $this->db->prepare('UPDATE dateien SET geloescht_am = UTC_TIMESTAMP() WHERE id = ?')->execute([$id]);
    }

    public function downloadUrl(array $row, int $ttl): string
    {
        return $this->storage->presignDownload($row['speicher_schluessel'], $ttl, $row['name']);
    }

    /** @return array<string,mixed> */
    public function row(int $kundeId, int $id): array
    {
        return $this->rowOrNull($kundeId, $id) ?? throw ApiException::notFound('Datei nicht gefunden.');
    }

    /** @return array<string,mixed>|null */
    private function rowOrNull(int $kundeId, int $id): ?array
    {
        $stmt = $this->db->prepare('SELECT * FROM dateien WHERE id = ? AND kunde_id = ? AND geloescht_am IS NULL');
        $stmt->execute([$id, $kundeId]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    /** @return array<string,mixed> */
    private function uploadRow(int $kundeId, int $id): array
    {
        $row = $this->row($kundeId, $id);
        if ($row['status'] !== 'upload' || $row['upload_id'] === null) {
            throw new ApiException(409, 'upload_closed', 'Für diese Datei läuft kein Upload.');
        }
        return $row;
    }

    /** @return array<string,mixed> */
    private function uploadInfo(array $row): array
    {
        return [
            'datei' => $this->present($row),
            'upload' => [
                'teilGroesse' => self::teilGroesse((int) $row['groesse']),
                'teileAnzahl' => self::teileAnzahl((int) $row['groesse']),
            ],
        ];
    }

    /** @return array<string,mixed> */
    private function present(array $row, bool $withUrl = false): array
    {
        $out = [
            'id' => (int) $row['id'],
            'ref' => 'f' . $row['id'],
            'name' => $row['name'],
            'mime' => $row['mime'],
            'typ' => str_starts_with($row['mime'], 'video/') ? 'video' : 'bild',
            'groesse' => (int) $row['groesse'],
            'sha256' => $row['sha256'],
            'status' => $row['status'],
            'breite' => $row['breite'] === null ? null : (int) $row['breite'],
            'hoehe' => $row['hoehe'] === null ? null : (int) $row['hoehe'],
            'dauerSekunden' => $row['dauer_sekunden'] === null ? null : (float) $row['dauer_sekunden'],
            'vorschauDateiId' => $row['vorschau_datei_id'] === null ? null : (int) $row['vorschau_datei_id'],
            'erstelltAm' => str_replace(' ', 'T', $row['erstellt_am']) . 'Z',
        ];
        if ($withUrl && $row['status'] === 'fertig') {
            $out['url'] = $this->downloadUrl($row, self::URL_TTL);
        }
        return $out;
    }
}
