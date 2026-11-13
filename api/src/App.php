<?php
declare(strict_types=1);

namespace Plinth\Api;

use PDO;
use Plinth\Api\Auth\AuthController;
use Plinth\Api\Auth\SessionService;
use Plinth\Api\Dateien\DateienController;
use Plinth\Api\Dateien\DateienService;
use Plinth\Api\Storage\S3Storage;
use Plinth\Api\Storage\Storage;
use Plinth\Api\Geraete\GeraeteController;
use Plinth\Api\Geraete\GeraeteService;
use Plinth\Api\Kunden\KundenController;
use Plinth\Api\Kunden\KundenService;
use Plinth\Api\Http\ApiException;
use Plinth\Api\Http\Request;
use Plinth\Api\Http\Response;
use Plinth\Api\Http\Router;

final class App
{
    public const VERSION = 'v1';

    private ?PDO $db = null;
    private ?AuthController $auth = null;
    private ?GeraeteController $geraete = null;
    private ?RateLimiter $limiter = null;

    private ?Storage $storage = null;

    /**
     * @param (\Closure():PDO)|null $dbFactory
     * @param (\Closure():Storage)|null $storageFactory
     */
    public function __construct(
        private Config $config,
        private Logger $logger,
        private ?\Closure $dbFactory = null,
        private ?\Closure $storageFactory = null,
    ) {
    }

    public static function fromConfig(Config $config): self
    {
        $logPath = $config->get('LOG_PATH', dirname(__DIR__) . '/storage/logs/api.log');
        return new self(
            $config,
            new Logger($logPath),
            fn () => Database::connect($config),
            fn () => S3Storage::fromConfig($config),
        );
    }

    public function handle(Request $request): Response
    {
        $requestId = bin2hex(random_bytes(8));
        $start = microtime(true);

        try {
            $this->checkRequestSafety($request);
            $response = $this->router()->dispatch($request);
        } catch (ApiException $e) {
            $response = Response::error($e->status, $e->errorCode, $e->getMessage(), $requestId, $e->details);
            $response->headers += $e->headers;
        } catch (\Throwable $e) {
            $this->logger->error('Unbehandelter Fehler', [
                'requestId' => $requestId,
                'exception' => $e::class,
                'message' => $e->getMessage(),
                'file' => $e->getFile() . ':' . $e->getLine(),
            ]);
            $message = $this->config->bool('APP_DEBUG') ? $e->getMessage() : 'Interner Fehler.';
            $response = Response::error(500, 'internal_error', $message, $requestId);
        }

        $response->headers['X-Request-Id'] = $requestId;
        $response->headers['Cache-Control'] = 'no-store';
        $response->headers['X-Content-Type-Options'] = 'nosniff';

        $this->logger->info('request', [
            'requestId' => $requestId,
            'method' => $request->method,
            'path' => $request->path,
            'status' => $response->status,
            'ms' => (int) round((microtime(true) - $start) * 1000),
            'ip' => $request->ip,
        ]);
        return $response;
    }

    private function router(): Router
    {
        $r = new Router();
        $v = '/' . self::VERSION;

        $r->get("$v/health", fn () => Response::json(['status' => 'ok', 'version' => self::VERSION]));

        $r->post("$v/auth/login", fn (Request $req) => $this->auth()->login($req));
        $r->post("$v/auth/logout", fn (Request $req) => $this->auth()->logout($req));
        $r->get("$v/auth/me", fn (Request $req) => $this->auth()->me($req));

        // Studio (angemeldeter Benutzer)
        $kunden = fn () => new KundenController(new KundenService($this->db()));
        $r->get("$v/kunde", $this->user(fn (Request $req) => $kunden()->show($req)));
        $r->post("$v/kunde/kundencode", $this->user(fn (Request $req) => $kunden()->rotateCode($req)));
        $r->get("$v/geraete", $this->user(fn (Request $req) => $this->geraete()->index($req)));
        $r->patch("$v/geraete/{id}", $this->user(fn (Request $req) => $this->geraete()->update($req)));
        $r->delete("$v/geraete/{id}", $this->user(fn (Request $req) => $this->geraete()->delete($req)));

        // Medien
        $d = fn () => new DateienController($this->dateienService());
        $r->post("$v/uploads", $this->user(fn (Request $req) => $d()->startUpload($req)));
        $r->get("$v/uploads/{id}", $this->user(fn (Request $req) => $d()->uploadStatus($req)));
        $r->post("$v/uploads/{id}/teile", $this->user(fn (Request $req) => $d()->teilUrls($req)));
        $r->post("$v/uploads/{id}/abschliessen", $this->user(fn (Request $req) => $d()->abschliessen($req)));
        $r->delete("$v/uploads/{id}", $this->user(fn (Request $req) => $d()->abbrechen($req)));
        $r->get("$v/dateien", $this->user(fn (Request $req) => $d()->index($req)));
        $r->get("$v/dateien/{id}", $this->user(fn (Request $req) => $d()->show($req)));
        $r->patch("$v/dateien/{id}", $this->user(fn (Request $req) => $d()->update($req)));
        $r->delete("$v/dateien/{id}", $this->user(fn (Request $req) => $d()->delete($req)));

        // Player (Gerätetoken)
        $r->post("$v/player/registrieren", fn (Request $req) => $this->geraete()->register($req));
        $r->get("$v/player/geraet", fn (Request $req) => $this->geraete()->self($req));

        return $r;
    }

    /** Umhüllt einen Handler: nur für angemeldete Benutzer. */
    private function user(\Closure $handler): \Closure
    {
        return function (Request $req) use ($handler) {
            $this->auth()->requireUser($req);
            return $handler($req);
        };
    }

    /**
     * Schutz gegen CSRF für schreibende Requests:
     * - nur JSON (HTML-Formulare anderer Seiten können kein application/json senden)
     * - wenn der Browser einen Origin mitsendet, muss er zu APP_URL passen
     * Zusätzlich ist das Sitzungscookie SameSite=Strict.
     */
    private function checkRequestSafety(Request $request): void
    {
        if (in_array($request->method, ['GET', 'HEAD', 'OPTIONS'], true)) {
            return;
        }
        // POST kann ein fremdes HTML-Formular senden; PUT/PATCH/DELETE nur per fetch mit CORS-Preflight.
        if (($request->method === 'POST' || $request->body !== '') && !$request->isJson()) {
            throw new ApiException(415, 'unsupported_media_type', 'Content-Type muss application/json sein.');
        }
        $origin = $request->header('origin');
        $appUrl = $this->config->get('APP_URL');
        if ($origin !== null && $appUrl !== null && rtrim($origin, '/') !== self::origin($appUrl)) {
            throw ApiException::forbidden('Ungültiger Origin.');
        }
    }

    private static function origin(string $url): string
    {
        $p = parse_url($url);
        $origin = ($p['scheme'] ?? 'https') . '://' . ($p['host'] ?? '');
        return isset($p['port']) ? $origin . ':' . $p['port'] : $origin;
    }

    private function db(): PDO
    {
        if ($this->db === null) {
            if ($this->dbFactory === null) {
                throw new \RuntimeException('Keine Datenbank konfiguriert.');
            }
            $this->db = ($this->dbFactory)();
        }
        return $this->db;
    }

    private function storage(): Storage
    {
        if ($this->storage === null) {
            if ($this->storageFactory === null) {
                throw new \RuntimeException('Kein Speicher konfiguriert.');
            }
            $this->storage = ($this->storageFactory)();
        }
        return $this->storage;
    }

    private function dateienService(): DateienService
    {
        return new DateienService(
            $this->db(),
            $this->storage(),
            $this->config->int('UPLOAD_MAX_GB', 20) * 1_000_000_000,
        );
    }

    private function limiter(): RateLimiter
    {
        return $this->limiter ??= new RateLimiter($this->db());
    }

    private function geraete(): GeraeteController
    {
        return $this->geraete ??= new GeraeteController(
            new GeraeteService($this->db()),
            new KundenService($this->db()),
            $this->limiter(),
        );
    }

    private function auth(): AuthController
    {
        return $this->auth ??= new AuthController(
            new SessionService(
                $this->db(),
                $this->config->int('SESSION_TTL_HOURS', 12) * 3600,
                $this->config->int('SESSION_REMEMBER_DAYS', 30) * 86400,
            ),
            $this->limiter(),
            rtrim($this->config->get('API_BASE_PATH', '/api'), '/') ?: '/',
            $this->config->bool('SESSION_COOKIE_SECURE', true),
        );
    }
}
