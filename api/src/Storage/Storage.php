<?php
declare(strict_types=1);

namespace Plinth\Api\Storage;

/**
 * Speicher für Mediendateien. Inhalte laufen nie durch PHP:
 * Browser und Player bekommen zeitlich begrenzte, signierte URLs.
 */
interface Storage
{
    /** Startet einen Multipart-Upload und liefert die Upload-ID. */
    public function createMultipartUpload(string $key, string $mime): string;

    /**
     * Signierte URL zum Hochladen eines Teils (HTTP PUT).
     *
     * @param string|null $sha256Base64 Prüfsumme des Teils; der Speicher lehnt abweichende Daten ab
     */
    public function presignUploadPart(string $key, string $uploadId, int $partNumber, int $ttlSeconds, ?string $sha256Base64 = null): string;

    /**
     * Bereits hochgeladene Teile (für die Wiederaufnahme).
     *
     * @return list<array{nummer:int,etag:string,groesse:int}>
     * @throws UploadNotFound wenn der Speicher den Upload nicht (mehr) kennt
     */
    public function listParts(string $key, string $uploadId): array;

    /** @param list<array{nummer:int,etag:string}> $parts */
    public function completeMultipartUpload(string $key, string $uploadId, array $parts): void;

    public function abortMultipartUpload(string $key, string $uploadId): void;

    /** Signierte Download-URL (HTTP GET). */
    public function presignDownload(string $key, int $ttlSeconds, ?string $downloadName = null): string;

    /** Größe in Bytes oder null, wenn das Objekt nicht existiert. */
    public function size(string $key): ?int;

    public function exists(string $key): bool;

    public function delete(string $key): void;

    /**
     * Liest ein Objekt als Stream (nur für Prüfaufgaben auf der Kommandozeile, nie im Web-Request).
     *
     * @return resource
     */
    public function readStream(string $key);
}
