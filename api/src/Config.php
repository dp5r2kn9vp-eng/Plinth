<?php
declare(strict_types=1);

namespace Plinth\Api;

/**
 * Konfiguration aus Umgebungsvariablen bzw. .env-Datei.
 * Zugangsdaten stehen nur in der .env auf dem Server, nie im Repository.
 */
final class Config
{
    /** @param array<string,string> $values */
    private function __construct(private array $values)
    {
    }

    /**
     * Lädt die Konfigurationsdatei. Gesucht wird (erste vorhandene gewinnt):
     *   1. PLINTH_ENV_FILE (Umgebungsvariable)
     *   2. plinth.env eine Ebene ÜBER dem Webroot (empfohlen, nie per Web erreichbar)
     *   3. .env im Webroot (nur mit Schutz durch .htaccess)
     * Echte Umgebungsvariablen haben Vorrang vor Werten aus der Datei.
     */
    public static function load(?string $envFile = null): self
    {
        $envFile ??= self::findEnvFile();
        $values = $envFile !== null && is_file($envFile) ? self::parseEnvFile($envFile) : [];

        foreach (array_keys($values) as $key) {
            $real = getenv($key);
            if ($real !== false) {
                $values[$key] = $real;
            }
        }
        return new self($values);
    }

    private static function findEnvFile(): ?string
    {
        $candidates = [
            getenv('PLINTH_ENV_FILE') ?: null,
            dirname(__DIR__, 3) . '/plinth.env',
            dirname(__DIR__, 2) . '/.env',
        ];
        foreach ($candidates as $file) {
            if ($file !== null && is_file($file)) {
                return $file;
            }
        }
        return null;
    }

    /** @param array<string,string> $values */
    public static function fromArray(array $values): self
    {
        return new self($values);
    }

    /** @return array<string,string> */
    private static function parseEnvFile(string $file): array
    {
        $values = [];
        foreach (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
            $line = trim($line);
            if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) {
                continue;
            }
            [$key, $value] = array_map('trim', explode('=', $line, 2));
            if (strlen($value) >= 2 && ($value[0] === '"' || $value[0] === "'") && $value[-1] === $value[0]) {
                $value = substr($value, 1, -1);
            }
            $values[$key] = $value;
        }
        return $values;
    }

    public function get(string $key, ?string $default = null): ?string
    {
        $value = $this->values[$key] ?? getenv($key);
        return ($value === false || $value === null || $value === '') ? $default : (string) $value;
    }

    public function require(string $key): string
    {
        $value = $this->get($key);
        if ($value === null) {
            throw new \RuntimeException("Konfiguration fehlt: {$key}");
        }
        return $value;
    }

    public function bool(string $key, bool $default = false): bool
    {
        $value = $this->get($key);
        return $value === null ? $default : filter_var($value, FILTER_VALIDATE_BOOLEAN);
    }

    public function int(string $key, int $default): int
    {
        $value = $this->get($key);
        return $value === null ? $default : (int) $value;
    }
}
