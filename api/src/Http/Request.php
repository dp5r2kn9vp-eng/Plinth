<?php
declare(strict_types=1);

namespace Plinth\Api\Http;

final class Request
{
    /** @var array<string,mixed>|null */
    private ?array $json = null;

    /** @var array<string,string> Pfadparameter aus dem Router */
    public array $params = [];

    /** @var array<string,mixed> Werte, die Middleware/Handler anhängen (z. B. angemeldeter Benutzer) */
    public array $attributes = [];

    /**
     * @param array<string,string> $headers Header-Namen in Kleinbuchstaben
     * @param array<string,string> $cookies
     * @param array<string,string> $query
     */
    public function __construct(
        public readonly string $method,
        public readonly string $path,
        public readonly array $headers = [],
        public readonly string $body = '',
        public readonly array $cookies = [],
        public readonly array $query = [],
        public readonly string $ip = '0.0.0.0',
    ) {
    }

    public static function fromGlobals(string $basePath): self
    {
        $headers = [];
        foreach ($_SERVER as $key => $value) {
            if (str_starts_with($key, 'HTTP_')) {
                $headers[strtolower(str_replace('_', '-', substr($key, 5)))] = (string) $value;
            }
        }
        if (isset($_SERVER['CONTENT_TYPE'])) {
            $headers['content-type'] = (string) $_SERVER['CONTENT_TYPE'];
        }

        $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
        $basePath = rtrim($basePath, '/');
        if ($basePath !== '' && str_starts_with($path, $basePath . '/')) {
            $path = substr($path, strlen($basePath));
        }

        return new self(
            strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET'),
            '/' . trim($path, '/'),
            $headers,
            (string) file_get_contents('php://input'),
            array_map('strval', $_COOKIE),
            array_map('strval', array_filter($_GET, 'is_scalar')),
            (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'),
        );
    }

    public function header(string $name): ?string
    {
        return $this->headers[strtolower($name)] ?? null;
    }

    public function cookie(string $name): ?string
    {
        return $this->cookies[$name] ?? null;
    }

    public function isJson(): bool
    {
        $type = strtolower($this->header('content-type') ?? '');
        return str_starts_with($type, 'application/json');
    }

    /** @return array<string,mixed> */
    public function json(): array
    {
        if ($this->json !== null) {
            return $this->json;
        }
        if (trim($this->body) === '') {
            return $this->json = [];
        }
        try {
            $data = json_decode($this->body, true, 32, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw ApiException::badRequest('invalid_json', 'Der Request-Body ist kein gültiges JSON.');
        }
        if (!is_array($data) || array_is_list($data) && $data !== []) {
            throw ApiException::badRequest('invalid_json', 'Der Request-Body muss ein JSON-Objekt sein.');
        }
        return $this->json = $data;
    }
}
