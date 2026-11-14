<?php
declare(strict_types=1);

namespace Plinth\Api\Storage;

use Aws\S3\Exception\S3Exception;
use Aws\S3\S3Client;
use Plinth\Api\Config;

/**
 * S3-kompatibler Speicher (Cloudflare R2, Hetzner Object Storage, AWS, MinIO).
 * Der Bucket bleibt privat; Zugangsdaten nur serverseitig in der .env.
 */
final class S3Storage implements Storage
{
    public function __construct(private S3Client $client, private string $bucket)
    {
    }

    public static function fromConfig(Config $config): self
    {
        $client = new S3Client([
            'version' => '2006-03-01',
            'region' => $config->get('S3_REGION', 'auto'),
            'endpoint' => $config->get('S3_ENDPOINT'),
            'use_path_style_endpoint' => $config->bool('S3_PATH_STYLE', true),
            'credentials' => [
                'key' => $config->require('S3_KEY'),
                'secret' => $config->require('S3_SECRET'),
            ],
            // Nur Prüfsummen senden/prüfen, wenn ausdrücklich angegeben (nicht alle Anbieter unterstützen CRC-Defaults).
            'request_checksum_calculation' => 'when_required',
            'response_checksum_validation' => 'when_required',
        ]);
        return new self($client, $config->require('S3_BUCKET'));
    }

    public function createMultipartUpload(string $key, string $mime): string
    {
        $args = ['Bucket' => $this->bucket, 'Key' => $key, 'ContentType' => $mime];
        return (string) $this->client->createMultipartUpload($args)['UploadId'];
    }

    public function presignUploadPart(string $key, string $uploadId, int $partNumber, int $ttlSeconds, ?string $sha256Base64 = null): string
    {
        $args = ['Bucket' => $this->bucket, 'Key' => $key, 'UploadId' => $uploadId, 'PartNumber' => $partNumber];
        if ($sha256Base64 !== null) {
            $args['ChecksumSHA256'] = $sha256Base64;
        }
        $cmd = $this->client->getCommand('UploadPart', $args);
        return (string) $this->client->createPresignedRequest($cmd, "+{$ttlSeconds} seconds")->getUri();
    }

    public function listParts(string $key, string $uploadId): array
    {
        $parts = [];
        $marker = null;
        do {
            $args = ['Bucket' => $this->bucket, 'Key' => $key, 'UploadId' => $uploadId, 'MaxParts' => 1000];
            if ($marker !== null) {
                $args['PartNumberMarker'] = $marker;
            }
            try {
                $res = $this->client->listParts($args);
            } catch (S3Exception $e) {
                if ($e->getAwsErrorCode() === 'NoSuchUpload') {
                    throw new UploadNotFound('Multipart-Upload existiert im Speicher nicht.', 0, $e);
                }
                throw $e;
            }
            foreach ($res['Parts'] ?? [] as $p) {
                $parts[] = ['nummer' => (int) $p['PartNumber'], 'etag' => (string) $p['ETag'], 'groesse' => (int) $p['Size']];
            }
            $marker = $res['NextPartNumberMarker'] ?? null;
        } while (!empty($res['IsTruncated']));
        return $parts;
    }

    public function completeMultipartUpload(string $key, string $uploadId, array $parts): void
    {
        usort($parts, fn ($a, $b) => $a['nummer'] <=> $b['nummer']);
        $this->client->completeMultipartUpload([
            'Bucket' => $this->bucket,
            'Key' => $key,
            'UploadId' => $uploadId,
            'MultipartUpload' => ['Parts' => array_map(
                fn ($p) => ['PartNumber' => $p['nummer'], 'ETag' => $p['etag']],
                $parts,
            )],
        ]);
    }

    public function abortMultipartUpload(string $key, string $uploadId): void
    {
        try {
            $this->client->abortMultipartUpload(['Bucket' => $this->bucket, 'Key' => $key, 'UploadId' => $uploadId]);
        } catch (S3Exception $e) {
            if ($e->getAwsErrorCode() !== 'NoSuchUpload') {
                throw $e;
            }
        }
    }

    public function presignDownload(string $key, int $ttlSeconds, ?string $downloadName = null): string
    {
        $args = ['Bucket' => $this->bucket, 'Key' => $key];
        if ($downloadName !== null) {
            $args['ResponseContentDisposition'] = 'inline; filename*=UTF-8\'\'' . rawurlencode($downloadName);
        }
        $cmd = $this->client->getCommand('GetObject', $args);
        return (string) $this->client->createPresignedRequest($cmd, "+{$ttlSeconds} seconds")->getUri();
    }

    public function size(string $key): ?int
    {
        try {
            return (int) $this->client->headObject(['Bucket' => $this->bucket, 'Key' => $key])['ContentLength'];
        } catch (S3Exception $e) {
            if ($e->getStatusCode() === 404) {
                return null;
            }
            throw $e;
        }
    }

    public function exists(string $key): bool
    {
        return $this->size($key) !== null;
    }

    public function delete(string $key): void
    {
        $this->client->deleteObject(['Bucket' => $this->bucket, 'Key' => $key]);
    }

    public function readStream(string $key)
    {
        $body = $this->client->getObject(['Bucket' => $this->bucket, 'Key' => $key, '@http' => ['stream' => true]])['Body'];
        return \GuzzleHttp\Psr7\StreamWrapper::getResource($body);
    }

    /** Für bin/s3-setup.php: CORS, damit der Browser direkt hochladen kann. */
    public function configureCors(string $allowedOrigin): void
    {
        $this->client->putBucketCors([
            'Bucket' => $this->bucket,
            'CORSConfiguration' => ['CORSRules' => [[
                'AllowedOrigins' => [$allowedOrigin],
                'AllowedMethods' => ['PUT', 'GET', 'HEAD'],
                'AllowedHeaders' => ['*'],
                'ExposeHeaders' => ['ETag'],
                'MaxAgeSeconds' => 3600,
            ]]],
        ]);
    }

    public function client(): S3Client
    {
        return $this->client;
    }

    public function bucket(): string
    {
        return $this->bucket;
    }
}
