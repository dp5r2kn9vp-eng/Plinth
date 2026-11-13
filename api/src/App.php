<?php
declare(strict_types=1);

namespace Plinth\Api;

use PDO;
use Plinth\Api\Auth\AuthController;
use Plinth\Api\Auth\SessionService;
use Plinth\Api\Http\ApiException;
use Plinth\Api\Http\Request;
use Plinth\Api\Http\Response;
use Plinth\Api\Http\Router;

final class App
{
    public const VERSION = 'v1';

    private ?PDO $db = null;
    private ?AuthController $auth = null;

    /** @param (\Closure():PDO)|null $dbFactory */
    public function __construct(
        private Config $config,
        private Logger $logger,
        private ?\Closure $dbFactory = null,
    ) {
    }

    public static function fromConfig(Config $config): self
    {
        $logPath = $config->get('LOG_PATH', dirname(__DIR__) . '/storage/logs/api.log');
        return new self($config, new Logger($logPath), fn () => Database::connect($config));
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

        return $r;
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
        if (!$request->isJson()) {
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

    private function auth(): AuthController
    {
        return $this->auth ??= new AuthController(
            new SessionService(
                $this->db(),
                $this->config->int('SESSION_TTL_HOURS', 12) * 3600,
                $this->config->int('SESSION_REMEMBER_DAYS', 30) * 86400,
            ),
            new RateLimiter($this->db()),
            rtrim($this->config->get('API_BASE_PATH', '/api'), '/') ?: '/',
            $this->config->bool('SESSION_COOKIE_SECURE', true),
        );
    }
}
