<?php
declare(strict_types=1);

namespace Plinth\Api\Schema;

use Opis\JsonSchema\Errors\ErrorFormatter;
use Opis\JsonSchema\Validator;

/**
 * Prüft Layouts und Manifeste gegen die JSON-Schemas in /shared/schemas
 * und zusätzlich auf inhaltliche Fehler, die ein Schema nicht ausdrücken kann.
 */
final class SchemaValidator
{
    private const BASE = 'https://plinth.klangniveau.de/schemas/';

    private Validator $validator;

    public function __construct(?string $schemaDir = null)
    {
        $schemaDir ??= dirname(__DIR__, 3) . '/shared/schemas';
        $this->validator = new Validator();
        $this->validator->setMaxErrors(20);
        $this->validator->resolver()->registerPrefix(self::BASE, $schemaDir);
    }

    /**
     * @return list<string> Fehler; leer = gültig
     */
    public function validateLayout(mixed $layout): array
    {
        $errors = $this->validate($layout, 'layout.schema.json');
        return $errors !== [] ? $errors : self::checkLayoutSemantics(self::toArray($layout), null);
    }

    /**
     * @return list<string> Fehler; leer = gültig
     */
    public function validateManifest(mixed $manifest): array
    {
        $errors = $this->validate($manifest, 'manifest.schema.json');
        if ($errors !== []) {
            return $errors;
        }
        $m = self::toArray($manifest);
        $fileIds = array_column($m['files'], 'id');
        $errors = [];
        if (count($fileIds) !== count(array_unique($fileIds))) {
            $errors[] = '/files: doppelte Datei-IDs';
        }
        return array_merge($errors, self::checkLayoutSemantics($m['layout'], $fileIds));
    }

    /**
     * Liefert alle Datei-IDs, auf die ein Layout verweist.
     *
     * @param array<string,mixed> $layout
     * @return list<string>
     */
    public static function referencedAssets(array $layout): array
    {
        $refs = [];
        $pages = $layout['pages'] ?? [];
        foreach ($pages as $page) {
            if (isset($page['background']['image'])) {
                $refs[] = $page['background']['image'];
            }
            foreach ($page['elements'] ?? [] as $el) {
                foreach (['image', 'video', 'poster'] as $key) {
                    if (isset($el[$key]) && is_string($el[$key])) {
                        $refs[] = $el[$key];
                    }
                }
                if (($el['action']['type'] ?? null) === 'openVideo') {
                    $refs[] = $el['action']['video'];
                }
            }
        }
        return array_values(array_unique($refs));
    }

    /** @return list<string> */
    private function validate(mixed $data, string $schema): array
    {
        $result = $this->validator->validate(self::toObject($data), self::BASE . $schema);
        if ($result->isValid()) {
            return [];
        }
        $out = [];
        foreach ((new ErrorFormatter())->format($result->error(), true) as $path => $messages) {
            foreach ($messages as $message) {
                $out[] = ($path === '' ? '/' : $path) . ': ' . $message;
            }
        }
        return $out;
    }

    /**
     * @param array<string,mixed> $layout
     * @param list<string>|null $fileIds null = Dateiverweise nicht prüfen
     * @return list<string>
     */
    private static function checkLayoutSemantics(array $layout, ?array $fileIds): array
    {
        $errors = [];
        $expected = $layout['format']['orientation'] === 'portrait' ? [1080, 1920] : [1920, 1080];
        if ([$layout['format']['width'], $layout['format']['height']] !== $expected) {
            $errors[] = sprintf('/format: %s erwartet %dx%d', $layout['format']['orientation'], ...$expected);
        }

        $pageIds = array_column($layout['pages'], 'id');
        if (count($pageIds) !== count(array_unique($pageIds))) {
            $errors[] = '/pages: doppelte Seiten-IDs';
        }
        foreach ($layout['pages'] as $p => $page) {
            $ids = array_column($page['elements'], 'id');
            if (count($ids) !== count(array_unique($ids))) {
                $errors[] = "/pages/{$p}/elements: doppelte Element-IDs";
            }
            foreach ($page['elements'] as $e => $el) {
                $target = $el['action']['page'] ?? null;
                if (($el['action']['type'] ?? null) === 'openPage' && !in_array($target, $pageIds, true)) {
                    $errors[] = "/pages/{$p}/elements/{$e}/action/page: Seite \"{$target}\" gibt es nicht";
                }
            }
        }

        if ($fileIds !== null) {
            foreach (self::referencedAssets($layout) as $ref) {
                if (!in_array($ref, $fileIds, true)) {
                    $errors[] = "/layout: Datei \"{$ref}\" fehlt in files";
                }
            }
        }
        return $errors;
    }

    private static function toObject(mixed $data): mixed
    {
        return json_decode(json_encode($data, JSON_THROW_ON_ERROR), false, 64, JSON_THROW_ON_ERROR);
    }

    /** @return array<string,mixed> */
    private static function toArray(mixed $data): array
    {
        return json_decode(json_encode($data, JSON_THROW_ON_ERROR), true, 64, JSON_THROW_ON_ERROR);
    }
}
