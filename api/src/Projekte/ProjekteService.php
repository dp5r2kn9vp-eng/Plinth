<?php
declare(strict_types=1);

namespace Plinth\Api\Projekte;

use PDO;
use Plinth\Api\Http\ApiException;
use Plinth\Api\Schema\SchemaValidator;

/** Projekte (ein Bildschirm-Inhalt) und ihr Entwurf. */
final class ProjekteService
{
    public function __construct(private PDO $db, private SchemaValidator $schema)
    {
    }

    /** Leeres Start-Layout für ein neues Projekt. */
    public static function startLayout(string $ausrichtung): array
    {
        [$w, $h] = $ausrichtung === 'portrait' ? [1080, 1920] : [1920, 1080];
        return [
            'schemaVersion' => 1,
            'format' => ['orientation' => $ausrichtung, 'width' => $w, 'height' => $h],
            'idleTimeoutSeconds' => 120,
            'pages' => [['id' => 'home', 'name' => 'Startseite', 'background' => ['color' => '#0e1116'], 'elements' => []]],
            'videoPage' => [
                'background' => '#000000',
                'fit' => 'contain',
                'header' => ['height' => 110, 'background' => '#151a22', 'color' => '#ffffff', 'backLabel' => 'Zurück', 'showTitle' => true, 'fontSize' => 40],
            ],
        ];
    }

    /** @return list<array<string,mixed>> */
    public function list(int $kundeId): array
    {
        $stmt = $this->db->prepare(
            'SELECT p.*, (SELECT MAX(nummer) FROM revisionen r WHERE r.projekt_id = p.id AND r.status = \'aktiv\') AS revision,
                    e.aktualisiert_am AS entwurf_am
             FROM projekte p LEFT JOIN entwuerfe e ON e.projekt_id = p.id
             WHERE p.kunde_id = ? ORDER BY p.id'
        );
        $stmt->execute([$kundeId]);
        return array_map([self::class, 'present'], $stmt->fetchAll());
    }

    /** @return array<string,mixed> */
    public function get(int $kundeId, int $id): array
    {
        foreach ($this->list($kundeId) as $p) {
            if ($p['id'] === $id) {
                return $p;
            }
        }
        throw ApiException::notFound('Projekt nicht gefunden.');
    }

    /** @return array<string,mixed> */
    public function create(int $kundeId, int $userId, string $name, string $ausrichtung): array
    {
        $errors = [];
        if ($name === '' || mb_strlen($name) > 190) {
            $errors['name'] = 'Name fehlt oder ist zu lang.';
        }
        if (!in_array($ausrichtung, ['landscape', 'portrait'], true)) {
            $errors['ausrichtung'] = 'landscape oder portrait.';
        }
        if ($errors !== []) {
            throw ApiException::validation($errors);
        }
        $this->db->beginTransaction();
        $this->db->prepare('INSERT INTO projekte (kunde_id, name, ausrichtung) VALUES (?, ?, ?)')->execute([$kundeId, $name, $ausrichtung]);
        $id = (int) $this->db->lastInsertId();
        $this->db->prepare('INSERT INTO entwuerfe (projekt_id, layout, aktualisiert_am, aktualisiert_von) VALUES (?, ?, UTC_TIMESTAMP(), ?)')
            ->execute([$id, self::encode(self::startLayout($ausrichtung)), $userId]);
        $this->db->commit();
        return $this->get($kundeId, $id);
    }

    /** @return array<string,mixed> */
    public function rename(int $kundeId, int $id, string $name): array
    {
        $this->get($kundeId, $id);
        if ($name === '' || mb_strlen($name) > 190) {
            throw ApiException::validation(['name' => 'Name fehlt oder ist zu lang.']);
        }
        $this->db->prepare('UPDATE projekte SET name = ? WHERE id = ?')->execute([$name, $id]);
        return $this->get($kundeId, $id);
    }

    /** @return array{layout:array<string,mixed>,version:int,aktualisiertAm:string} */
    public function draft(int $kundeId, int $id): array
    {
        $this->get($kundeId, $id);
        $stmt = $this->db->prepare('SELECT layout, version, aktualisiert_am FROM entwuerfe WHERE projekt_id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if ($row === false) {
            $p = $this->get($kundeId, $id);
            $this->db->prepare('INSERT INTO entwuerfe (projekt_id, layout, aktualisiert_am) VALUES (?, ?, UTC_TIMESTAMP())')
                ->execute([$id, self::encode(self::startLayout($p['ausrichtung']))]);
            return $this->draft($kundeId, $id);
        }
        return [
            'layout' => json_decode($row['layout'], true, 64, JSON_THROW_ON_ERROR),
            'version' => (int) $row['version'],
            'aktualisiertAm' => str_replace(' ', 'T', $row['aktualisiert_am']) . 'Z',
        ];
    }

    /**
     * Speichert den Entwurf. $version muss der zuletzt geladenen entsprechen,
     * sonst 409 (jemand anderes hat inzwischen gespeichert).
     *
     * @return array{layout:array<string,mixed>,version:int,aktualisiertAm:string}
     */
    public function saveDraft(int $kundeId, int $userId, int $id, mixed $layout, int $version): array
    {
        $this->draft($kundeId, $id);
        $errors = $this->schema->validateLayout($layout);
        if ($errors !== []) {
            throw new ApiException(422, 'invalid_layout', 'Layout ist ungültig.', ['errors' => $errors]);
        }
        $stmt = $this->db->prepare(
            'UPDATE entwuerfe SET layout = ?, version = version + 1, aktualisiert_am = UTC_TIMESTAMP(), aktualisiert_von = ?
             WHERE projekt_id = ? AND version = ?'
        );
        $stmt->execute([self::encode($layout), $userId, $id, $version]);
        if ($stmt->rowCount() === 0) {
            $current = $this->draft($kundeId, $id);
            throw new ApiException(409, 'draft_conflict', 'Der Entwurf wurde inzwischen an anderer Stelle geändert.', ['version' => $current['version']]);
        }
        $this->db->prepare('UPDATE projekte SET ausrichtung = ? WHERE id = ?')->execute([$layout['format']['orientation'], $id]);
        return $this->draft($kundeId, $id);
    }

    public static function encode(mixed $data): string
    {
        return json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    /** @return array<string,mixed> */
    private static function present(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'name' => $row['name'],
            'ausrichtung' => $row['ausrichtung'],
            'revision' => $row['revision'] === null ? null : (int) $row['revision'],
            'entwurfAm' => $row['entwurf_am'] === null ? null : str_replace(' ', 'T', $row['entwurf_am']) . 'Z',
        ];
    }
}
