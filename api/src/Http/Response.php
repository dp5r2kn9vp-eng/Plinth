<?php
declare(strict_types=1);

namespace Plinth\Api\Http;

final class Response
{
    /** @var list<string> Fertige Set-Cookie-Zeilen */
    public array $cookies = [];

    /** @param array<string,string> $headers */
    public function __construct(
        public int $status = 200,
        public string $body = '',
        public array $headers = [],
    ) {
    }

    public static function json(mixed $data, int $status = 200): self
    {
        return new self(
            $status,
            json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
            ['Content-Type' => 'application/json; charset=utf-8'],
        );
    }

    public static function noContent(): self
    {
        return new self(204);
    }

    /** @param array<string,mixed> $details */
    public static function error(int $status, string $code, string $message, string $requestId, array $details = []): self
    {
        $error = ['code' => $code, 'message' => $message, 'requestId' => $requestId];
        if ($details !== []) {
            $error['details'] = $details;
        }
        return self::json(['error' => $error], $status);
    }

    /**
     * @param array{expires?:int|null,path?:string,secure?:bool,httpOnly?:bool,sameSite?:string} $options
     */
    public function withCookie(string $name, string $value, array $options = []): self
    {
        $parts = [rawurlencode($name) . '=' . rawurlencode($value)];
        $expires = $options['expires'] ?? null;
        if ($expires !== null) {
            $parts[] = 'Expires=' . gmdate('D, d M Y H:i:s \G\M\T', $expires);
            $parts[] = 'Max-Age=' . max(0, $expires - time());
        }
        $parts[] = 'Path=' . ($options['path'] ?? '/');
        if ($options['secure'] ?? true) {
            $parts[] = 'Secure';
        }
        if ($options['httpOnly'] ?? true) {
            $parts[] = 'HttpOnly';
        }
        $parts[] = 'SameSite=' . ($options['sameSite'] ?? 'Strict');
        $this->cookies[] = implode('; ', $parts);
        return $this;
    }

    public function send(): void
    {
        http_response_code($this->status);
        foreach ($this->headers as $name => $value) {
            header("{$name}: {$value}");
        }
        foreach ($this->cookies as $cookie) {
            header('Set-Cookie: ' . $cookie, false);
        }
        echo $this->body;
    }
}
