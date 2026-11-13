<?php
declare(strict_types=1);

namespace Plinth\Api;

/** Zufällige Zugangstokens (256 Bit, URL-sicher). Gespeichert wird nur der Hash. */
final class Token
{
    public static function generate(): string
    {
        return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    }

    public static function hash(string $token): string
    {
        return hash('sha256', $token);
    }
}
