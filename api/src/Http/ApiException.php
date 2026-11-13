<?php
declare(strict_types=1);

namespace Plinth\Api\Http;

/**
 * Fachlicher Fehler, der als einheitliches JSON-Fehlerformat ausgegeben wird.
 */
final class ApiException extends \RuntimeException
{
    /**
     * @param array<string,mixed> $details
     * @param array<string,string> $headers
     */
    public function __construct(
        public readonly int $status,
        public readonly string $errorCode,
        string $message,
        public readonly array $details = [],
        public readonly array $headers = [],
    ) {
        parent::__construct($message);
    }

    public static function badRequest(string $code, string $message): self
    {
        return new self(400, $code, $message);
    }

    public static function unauthorized(string $message = 'Nicht angemeldet.'): self
    {
        return new self(401, 'unauthorized', $message);
    }

    public static function forbidden(string $message = 'Keine Berechtigung.'): self
    {
        return new self(403, 'forbidden', $message);
    }

    public static function notFound(string $message = 'Ressource nicht gefunden.'): self
    {
        return new self(404, 'not_found', $message);
    }

    /** @param array<string,string> $fields Feldname => Fehlermeldung */
    public static function validation(array $fields): self
    {
        return new self(422, 'validation_failed', 'Eingaben sind ungültig.', ['fields' => $fields]);
    }

    public static function tooManyRequests(int $retryAfter): self
    {
        return new self(
            429,
            'too_many_requests',
            'Zu viele Anfragen. Bitte später erneut versuchen.',
            ['retryAfter' => $retryAfter],
            ['Retry-After' => (string) $retryAfter],
        );
    }
}
