<?php
declare(strict_types=1);

use Plinth\Api\App;
use Plinth\Api\Config;
use Plinth\Api\Http\Request;

require dirname(__DIR__) . '/vendor/autoload.php';

$config = Config::load();
$request = Request::fromGlobals($config->get('API_BASE_PATH', '/api'));
App::fromConfig($config)->handle($request)->send();
