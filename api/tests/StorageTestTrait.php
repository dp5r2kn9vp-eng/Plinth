<?php
declare(strict_types=1);

namespace Plinth\Api\Tests;

use Plinth\Api\Config;
use Plinth\Api\Storage\S3Storage;

/**
 * Echter S3-kompatibler Speicher für Tests (z. B. moto_server oder MinIO).
 * TEST_S3_ENDPOINT leer → Tests werden übersprungen.
 */
trait StorageTestTrait
{
    protected static ?S3Storage $storage = null;

    protected static function storage(): S3Storage
    {
        $endpoint = getenv('TEST_S3_ENDPOINT') ?: '';
        if ($endpoint === '') {
            self::markTestSkipped('TEST_S3_ENDPOINT nicht gesetzt.');
        }
        if (self::$storage === null) {
            self::$storage = S3Storage::fromConfig(Config::fromArray([
                'S3_ENDPOINT' => $endpoint,
                'S3_REGION' => 'us-east-1',
                'S3_BUCKET' => 'plinth-test-' . bin2hex(random_bytes(4)),
                'S3_KEY' => getenv('TEST_S3_KEY') ?: 'test',
                'S3_SECRET' => getenv('TEST_S3_SECRET') ?: 'test',
            ]));
            self::$storage->client()->createBucket(['Bucket' => self::$storage->bucket()]);
        }
        return self::$storage;
    }

    /** PUT auf eine signierte URL, liefert [Status, ETag]. @param array<string,string> $headers */
    protected static function put(string $url, string $data, array $headers = []): array
    {
        $res = (new \GuzzleHttp\Client(['http_errors' => false]))->put($url, ['body' => $data, 'headers' => $headers]);
        return [$res->getStatusCode(), $res->getHeaderLine('ETag')];
    }

    protected static function get(string $url): array
    {
        $res = (new \GuzzleHttp\Client(['http_errors' => false]))->get($url);
        return [$res->getStatusCode(), (string) $res->getBody()];
    }
}
