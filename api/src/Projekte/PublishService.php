<?php
declare(strict_types=1);

namespace Plinth\Api\Projekte;

use PDO;
use Plinth\Api\Dateien\DateienService;
use Plinth\Api\Http\ApiException;
use Plinth\Api\Schema\SchemaValidator;
use Plinth\Api\Storage\Storage;

/**
 * Friert den Entwurf zu einer Revision ein und schreibt das Manifest.
 * Alles wird geprüft, bevor die Revision angelegt wird: Entweder es gibt danach
 * eine vollständige, aktive Revision oder gar keine Änderung.
 */
final class PublishService
{
    private const LOCAL_TIME = '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/';

    public function __construct(
        private PDO $db,
        private Storage $storage,
        private SchemaValidator $schema,
        private ProjekteService $projekte,
    ) {
    }

    /**
     * @param array{gueltigAb?:?string,gueltigBis?:?string,prioritaet?:int} $optionen
     * @return array<string,mixed>
     */
    public function publish(int $kundeId, int $userId, int $projektId, array $optionen = []): array
    {
        $draft = $this->projekte->draft($kundeId, $projektId);
        $layout = $draft['layout'];

        $validFrom = $optionen['gueltigAb'] ?? null;
        $validTo = $optionen['gueltigBis'] ?? null;
        foreach (['gueltigAb' => $validFrom, 'gueltigBis' => $validTo] as $k => $v) {
            if ($v !== null && !preg_match(self::LOCAL_TIME, $v)) {
                throw ApiException::validation([$k => 'Lokale Zeit wie 2026-12-01T08:00.']);
            }
        }
        if ($validFrom !== null && $validTo !== null && $validTo <= $validFrom) {
            throw ApiException::validation(['gueltigBis' => 'Muss nach gueltigAb liegen.']);
        }

        $errors = $this->schema->validateLayout($layout);
        if ($errors !== []) {
            throw new ApiException(422, 'invalid_layout', 'Der Entwurf ist ungültig.', ['errors' => $errors]);
        }

        $layout = $this->fillPosters($kundeId, $layout);
        $files = $this->resolveFiles($kundeId, SchemaValidator::referencedAssets($layout));

        $this->db->beginTransaction();
        try {
            // Projektzeile sperren: Revisionsnummern ohne Lücken und ohne Doppelvergabe.
            $this->db->prepare('SELECT id FROM projekte WHERE id = ? FOR UPDATE')->execute([$projektId]);
            $nummer = 1 + (int) $this->db->query("SELECT COALESCE(MAX(nummer), 0) FROM revisionen WHERE projekt_id = {$projektId}")->fetchColumn();

            $manifest = [
                'schemaVersion' => 1,
                'revision' => $nummer,
                'publishedAt' => gmdate('Y-m-d\TH:i:s\Z'),
                'validFrom' => $validFrom,
                'validTo' => $validTo,
                'priority' => $optionen['prioritaet'] ?? 0,
                'layout' => $layout,
                'files' => $files,
            ];
            $errors = $this->schema->validateManifest($manifest);
            if ($errors !== []) {
                throw new ApiException(422, 'invalid_manifest', 'Manifest ist ungültig.', ['errors' => $errors]);
            }

            $this->db->prepare(
                "INSERT INTO revisionen (projekt_id, nummer, manifest, status, veroeffentlicht_am, veroeffentlicht_von)
                 VALUES (?, ?, ?, 'aktiv', UTC_TIMESTAMP(), ?)"
            )->execute([$projektId, $nummer, ProjekteService::encode($manifest), $userId]);
            $revisionId = (int) $this->db->lastInsertId();

            if ($validFrom !== null || $validTo !== null || ($optionen['prioritaet'] ?? 0) !== 0) {
                $this->db->prepare('INSERT INTO zeitplaene (projekt_id, revision_id, gueltig_ab, gueltig_bis, prioritaet) VALUES (?, ?, ?, ?, ?)')
                    ->execute([$projektId, $revisionId, $validFrom, $validTo, $optionen['prioritaet'] ?? 0]);
            }
            $this->db->commit();
        } catch (\Throwable $e) {
            $this->db->rollBack();
            throw $e;
        }

        return [
            'nummer' => $nummer,
            'veroeffentlichtAm' => $manifest['publishedAt'],
            'dateien' => count($files),
            'groesse' => array_sum(array_column($files, 'size')),
        ];
    }

    /** @return list<array<string,mixed>> */
    public function revisions(int $kundeId, int $projektId): array
    {
        $this->projekte->get($kundeId, $projektId);
        $stmt = $this->db->prepare(
            'SELECT r.nummer, r.status, r.veroeffentlicht_am, b.name AS von
             FROM revisionen r LEFT JOIN benutzer b ON b.id = r.veroeffentlicht_von
             WHERE r.projekt_id = ? ORDER BY r.nummer DESC LIMIT 100'
        );
        $stmt->execute([$projektId]);
        return array_map(fn ($r) => [
            'nummer' => (int) $r['nummer'],
            'status' => $r['status'],
            'veroeffentlichtAm' => str_replace(' ', 'T', $r['veroeffentlicht_am']) . 'Z',
            'von' => $r['von'],
        ], $stmt->fetchAll());
    }

    /** Thumbnails ohne eigenes Vorschaubild bekommen das Standbild des Videos. */
    private function fillPosters(int $kundeId, array $layout): array
    {
        foreach ($layout['pages'] as &$page) {
            foreach ($page['elements'] as &$el) {
                if ($el['type'] === 'thumbnail' && !isset($el['poster'])) {
                    $id = self::fileId($el['video']);
                    $stmt = $this->db->prepare('SELECT vorschau_datei_id FROM dateien WHERE id = ? AND kunde_id = ?');
                    $stmt->execute([$id, $kundeId]);
                    $poster = $stmt->fetchColumn();
                    if ($poster !== false && $poster !== null) {
                        $el['poster'] = 'f' . $poster;
                    }
                }
            }
        }
        return $layout;
    }

    /**
     * @param list<string> $refs
     * @return list<array<string,mixed>>
     */
    private function resolveFiles(int $kundeId, array $refs): array
    {
        $files = [];
        $problems = [];
        foreach ($refs as $ref) {
            $id = self::fileId($ref);
            $stmt = $this->db->prepare('SELECT * FROM dateien WHERE id = ? AND kunde_id = ? AND geloescht_am IS NULL');
            $stmt->execute([$id ?? 0, $kundeId]);
            $row = $stmt->fetch();
            if ($row === false) {
                $problems[$ref] = 'Datei gibt es nicht (mehr).';
                continue;
            }
            if ($row['status'] !== 'fertig' || $row['sha256'] === null) {
                $problems[$ref] = $row['status'] === 'upload' ? "\"{$row['name']}\" wird noch hochgeladen." : "\"{$row['name']}\" ist fehlerhaft.";
                continue;
            }
            if ($this->storage->size($row['speicher_schluessel']) !== (int) $row['groesse']) {
                $problems[$ref] = "\"{$row['name']}\" fehlt im Speicher.";
                continue;
            }
            $files[] = [
                'id' => $ref,
                'path' => 'media/' . $row['sha256'] . '.' . DateienService::ERLAUBT[$row['mime']],
                'size' => (int) $row['groesse'],
                'sha256' => $row['sha256'],
                'mime' => $row['mime'],
            ];
        }
        if ($problems !== []) {
            throw new ApiException(422, 'files_not_ready', 'Nicht alle Dateien sind bereit.', ['dateien' => $problems]);
        }
        return $files;
    }

    private static function fileId(string $ref): ?int
    {
        return preg_match('/^f(\d+)$/', $ref, $m) ? (int) $m[1] : null;
    }
}
