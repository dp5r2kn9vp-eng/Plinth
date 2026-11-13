<?php
declare(strict_types=1);

namespace Plinth\Api\Projekte;

use Plinth\Api\Http\ApiException;
use Plinth\Api\Http\Request;
use Plinth\Api\Http\Response;

final class ProjekteController
{
    /** @param \Closure():PublishService $publish erst beim Veröffentlichen erzeugt (braucht den Speicher) */
    public function __construct(private ProjekteService $projekte, private \Closure $publish)
    {
    }

    private static function kunde(Request $r): int
    {
        return $r->attributes['user']['kundeId'];
    }

    private static function id(Request $r): int
    {
        return (int) $r->params['id'];
    }

    public function index(Request $r): Response
    {
        return Response::json(['projekte' => $this->projekte->list(self::kunde($r))]);
    }

    public function create(Request $r): Response
    {
        $d = $r->json();
        $p = $this->projekte->create(
            self::kunde($r),
            $r->attributes['user']['id'],
            is_string($d['name'] ?? null) ? trim($d['name']) : '',
            is_string($d['ausrichtung'] ?? null) ? $d['ausrichtung'] : 'landscape',
        );
        return Response::json(['projekt' => $p], 201);
    }

    public function update(Request $r): Response
    {
        $d = $r->json();
        $name = is_string($d['name'] ?? null) ? trim($d['name']) : '';
        return Response::json(['projekt' => $this->projekte->rename(self::kunde($r), self::id($r), $name)]);
    }

    public function draft(Request $r): Response
    {
        return Response::json($this->projekte->draft(self::kunde($r), self::id($r)));
    }

    public function saveDraft(Request $r): Response
    {
        $d = $r->json();
        if (!is_array($d['layout'] ?? null) || !is_int($d['version'] ?? null)) {
            throw ApiException::validation(['layout' => 'layout (Objekt) und version (Zahl) angeben.']);
        }
        return Response::json($this->projekte->saveDraft(self::kunde($r), $r->attributes['user']['id'], self::id($r), $d['layout'], $d['version']));
    }

    public function publish(Request $r): Response
    {
        $this->projekte->get(self::kunde($r), self::id($r));
        $d = $r->json();
        $opt = [];
        foreach (['gueltigAb', 'gueltigBis'] as $k) {
            if (isset($d[$k])) {
                is_string($d[$k]) ? $opt[$k] = $d[$k] : throw ApiException::validation([$k => 'Text erwartet.']);
            }
        }
        if (isset($d['prioritaet'])) {
            is_int($d['prioritaet']) ? $opt['prioritaet'] = $d['prioritaet'] : throw ApiException::validation(['prioritaet' => 'Ganze Zahl.']);
        }
        $rev = ($this->publish)()->publish(self::kunde($r), $r->attributes['user']['id'], self::id($r), $opt);
        return Response::json(['revision' => $rev], 201);
    }

    public function revisions(Request $r): Response
    {
        $this->projekte->get(self::kunde($r), self::id($r));
        return Response::json(['revisionen' => ($this->publish)()->revisions(self::kunde($r), self::id($r))]);
    }
}
