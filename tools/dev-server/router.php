<?php
// Router für den eingebauten PHP-Server (Entwicklung, CI):
//   PLINTH_ENV_FILE=… php -S 127.0.0.1:8099 tools/dev-server/router.php
// /api/* → API, /studio und /shared → statische Dateien mit korrekten MIME-Typen.
$root = dirname(__DIR__, 2);
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (str_starts_with($path, '/api/')) {
    require "$root/api/public/index.php";
    return true;
}
if ($path === '/' || $path === '/studio') {
    header('Location: /studio/');
    return true;
}
if (str_ends_with($path, '/')) {
    $path .= 'index.html';
}
$file = realpath($root . $path);
if ($file && str_starts_with($file, $root . '/') && is_file($file) && preg_match('#^/(studio|shared)/#', $path)) {
    $types = ['html' => 'text/html; charset=utf-8', 'js' => 'text/javascript', 'css' => 'text/css', 'svg' => 'image/svg+xml', 'json' => 'application/json'];
    header('Content-Type: ' . ($types[pathinfo($file, PATHINFO_EXTENSION)] ?? 'application/octet-stream'));
    readfile($file);
    return true;
}
http_response_code(404);
echo 'not found';
