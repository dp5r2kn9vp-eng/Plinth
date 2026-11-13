<?php
declare(strict_types=1);

// Richtet den Bucket ein: CORS für direkte Browser-Uploads von APP_URL.
// Nutzung: php bin/s3-setup.php [--create-bucket]

use Plinth\Api\Config;
use Plinth\Api\Storage\S3Storage;

require dirname(__DIR__) . '/vendor/autoload.php';

$config = Config::load();
$storage = S3Storage::fromConfig($config);
$opt = getopt('', ['create-bucket']);

if (isset($opt['create-bucket'])) {
    if (!$storage->client()->doesBucketExistV2($storage->bucket())) {
        $storage->client()->createBucket(['Bucket' => $storage->bucket()]);
        echo "Bucket angelegt: {$storage->bucket()}\n";
    }
}

$p = parse_url($config->require('APP_URL'));
$origin = $p['scheme'] . '://' . $p['host'] . (isset($p['port']) ? ':' . $p['port'] : '');
$storage->configureCors($origin);
echo "CORS gesetzt für {$origin} (PUT/GET/HEAD, ETag sichtbar).\n";
echo "Hinweis: Der Bucket muss privat bleiben (kein öffentlicher Zugriff).\n";
