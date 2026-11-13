<?php
declare(strict_types=1);

namespace Plinth\Api;

/**
 * Schreibt eine JSON-Zeile pro Eintrag. Passwörter und Tokens dürfen nie im Kontext landen.
 */
final class Logger
{
    public function __construct(private ?string $path)
    {
    }

    /** @param array<string,mixed> $context */
    public function info(string $message, array $context = []): void
    {
        $this->write('info', $message, $context);
    }

    /** @param array<string,mixed> $context */
    public function warning(string $message, array $context = []): void
    {
        $this->write('warning', $message, $context);
    }

    /** @param array<string,mixed> $context */
    public function error(string $message, array $context = []): void
    {
        $this->write('error', $message, $context);
    }

    /** @param array<string,mixed> $context */
    private function write(string $level, string $message, array $context): void
    {
        if ($this->path === null) {
            return;
        }
        $line = json_encode(
            ['ts' => gmdate('Y-m-d\TH:i:s\Z'), 'level' => $level, 'msg' => $message] + $context,
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE,
        );
        $dir = dirname($this->path);
        if (!is_dir($dir)) {
            @mkdir($dir, 0750, true);
        }
        if (@file_put_contents($this->path, $line . "\n", FILE_APPEND | LOCK_EX) === false) {
            error_log('[plinth-api] ' . $line);
        }
    }
}
