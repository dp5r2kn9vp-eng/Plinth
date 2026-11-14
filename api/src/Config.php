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
     *   2. config/plinth.env im Webroot (Ordner mit eigener .htaccess, die jeden Zugriff sperrt)
     *   3. plinth.env eine Ebene über dem Webroot
     *   4. plinth.env oder .env direkt im Webroot (nur durch die Webroot-.htaccess geschützt)
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

    /** Pfad der gefundenen Konfigurationsdatei oder null */
    public static function envFile(): ?string
    {
        return self::findEnvFile();
    }

    /**
     * Für die Fehlersuche: wo gesucht wurde und was dort liegt (ohne Inhalte).
     *
     * @return list<array{ort:string,status:string}>
     */
    public static function diagnose(): array
    {
        $places = [
            'Ordner config' => dirname(__DIR__, 2) . '/config',
            'Webroot' => dirname(__DIR__, 2),
            'über dem Webroot' => dirname(__DIR__, 3),
        ];
        $out = [];
        foreach ($places as $label => $dir) {
            foreach (['plinth.env', '.env', 'plinth.env.txt', 'plinth.env.vorlage', '.env.txt'] as $name) {
                $file = "{$dir}/{$name}";
                if (!file_exists($file)) {
                    continue;
                }
                $status = match (true) {
                    str_ends_with($name, '.txt') => 'gefunden, heißt aber „' . $name . '“ – bitte in „plinth.env“ umbenennen',
                    $name === 'plinth.env.vorlage' => 'nur die Vorlage – Kopie als „plinth.env“ speichern',
                    !is_readable($file) => 'gefunden, aber nicht lesbar (Dateirechte 644 setzen)',
                    default => 'gefunden',
                };
                $out[] = ['ort' => "{$label}: {$name}", 'status' => $status];
            }
        }
        if ($out === []) {
            $out[] = ['ort' => 'config/, Webroot und darüber', 'status' => 'keine plinth.env gefunden'];
        }
        return $out;
    }

    private static function findEnvFile(): ?string
    {
        $root = dirname(__DIR__, 2); // Webroot (Ordner mit api/, studio/, …)
        $candidates = [
            getenv('PLINTH_ENV_FILE') ?: null,
            $root . '/config/plinth.env',          // Standard: eigener, gesperrter Ordner im Webroot
            dirname($root) . '/plinth.env',        // alternativ über dem Webroot
            $root . '/plinth.env',                 // im Webroot (durch .htaccess gesperrt)
            $root . '/.env',
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
        foreach (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $i => $line) {
            if ($i === 0) {
                $line = (string) preg_replace('/^\xEF\xBB\xBF/', '', $line); // UTF-8-BOM (Windows-Editoren)
            }
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
