<?php
declare(strict_types=1);

// Ende-zu-Ende-Test des Uploads über die laufende API mit einer großen, erzeugten Datei.
// Die Daten werden on-the-fly erzeugt (keine Datei auf der Platte nötig).
// Nutzung: php bin/upload-smoke.php --api=https://host/api --email=... --password=... --gb=2

require dirname(__DIR__) . '/vendor/autoload.php';

$opt = getopt('', ['api:', 'email:', 'password:', 'gb:']);
$api = rtrim($opt['api'] ?? '', '/');
$bytes = (int) round((float) ($opt['gb'] ?? 1) * 1024 ** 3);
if ($api === '' || empty($opt['email']) || empty($opt['password'])) {
    fwrite(STDERR, "Nutzung: php bin/upload-smoke.php --api=URL --email=E --password=P [--gb=1]\n");
    exit(1);
}

$jar = new GuzzleHttp\Cookie\CookieJar();
$http = new GuzzleHttp\Client(['cookies' => $jar, 'http_errors' => false, 'timeout' => 600]);
$origin = parse_url($api, PHP_URL_SCHEME) . '://' . parse_url($api, PHP_URL_HOST) . (parse_url($api, PHP_URL_PORT) ? ':' . parse_url($api, PHP_URL_PORT) : '');
$call = function (string $method, string $path, array $json) use ($http, $api, $origin): array {
    $res = $http->request($method, $api . $path, ['json' => $json, 'headers' => ['Origin' => $origin]]);
    $body = json_decode((string) $res->getBody(), true);
    if ($res->getStatusCode() >= 300) {
        fwrite(STDERR, "{$method} {$path}: {$res->getStatusCode()} " . $res->getBody() . "\n");
        exit(1);
    }
    return $body ?? [];
};

$call('POST', '/v1/auth/login', ['email' => $opt['email'], 'password' => $opt['password']]);
$info = $call('POST', '/v1/uploads', ['name' => 'smoke-test.mp4', 'mime' => 'video/mp4', 'groesse' => $bytes]);
$id = $info['datei']['id'];
$teilGroesse = $info['upload']['teilGroesse'];
$anzahl = $info['upload']['teileAnzahl'];
printf("Upload #%d: %.2f GB in %d Teilen à %d MiB\n", $id, $bytes / 1024 ** 3, $anzahl, $teilGroesse / 1024 ** 2);

$hash = hash_init('sha256');
$teile = [];
$start = microtime(true);
$block = random_bytes(1024 * 1024);
for ($n = 1; $n <= $anzahl; $n++) {
    $len = min($teilGroesse, $bytes - ($n - 1) * $teilGroesse);
    // Teil aus einem Zufallsblock + Teilnummer erzeugen (jeder Teil unterschiedlich).
    $data = substr(str_repeat($block, intdiv($len, strlen($block)) + 1), 0, $len);
    $data = substr_replace($data, pack('N', $n), 0, 4);
    hash_update($hash, $data);
    $url = $call('POST', "/v1/uploads/{$id}/teile", ['teile' => [$n]])['urls'][(string) $n];
    $res = $http->put($url, ['body' => $data, 'cookies' => false]);
    if ($res->getStatusCode() !== 200) {
        fwrite(STDERR, "Teil {$n}: HTTP {$res->getStatusCode()}\n");
        exit(1);
    }
    $teile[] = ['nummer' => $n, 'etag' => $res->getHeaderLine('ETag')];
    if ($n % 25 === 0 || $n === $anzahl) {
        printf("  %d/%d Teile, %.0f MB/s\n", $n, $anzahl, ($n * $teilGroesse / 1e6) / max(0.001, microtime(true) - $start));
    }
}
$sha = hash_final($hash);
$datei = $call('POST', "/v1/uploads/{$id}/abschliessen", ['teile' => $teile, 'sha256' => $sha])['datei'];
printf("Fertig: Status %s, Größe %d Bytes, SHA-256 %s, %.1f s\n", $datei['status'], $datei['groesse'], $datei['sha256'], microtime(true) - $start);
exit($datei['status'] === 'fertig' && $datei['sha256'] === $sha ? 0 : 1);
