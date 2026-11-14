<?php
declare(strict_types=1);

namespace Plinth\Api\Dateien;

use Plinth\Api\Http\ApiException;
use Plinth\Api\Http\Request;
use Plinth\Api\Http\Response;

final class DateienController
{
    public function __construct(private DateienService $dateien)
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

    public function startUpload(Request $r): Response
    {
        $d = $r->json();
        $info = $this->dateien->startUpload(
            self::kunde($r),
            $r->attributes['user']['id'],
            is_string($d['name'] ?? null) ? trim($d['name']) : '',
            is_string($d['mime'] ?? null) ? strtolower($d['mime']) : '',
            is_int($d['groesse'] ?? null) ? $d['groesse'] : 0,
        );
        return Response::json($info, 201);
    }

    public function uploadStatus(Request $r): Response
    {
        return Response::json($this->dateien->uploadStatus(self::kunde($r), self::id($r)));
    }

    public function teilUrls(Request $r): Response
    {
        $d = $r->json();
        $nummern = is_array($d['teile'] ?? null) ? array_values($d['teile']) : [];
        $summen = is_array($d['pruefsummen'] ?? null) ? array_filter($d['pruefsummen'], 'is_string') : [];
        return Response::json([
            'urls' => $this->dateien->teilUrls(self::kunde($r), self::id($r), $nummern, $summen),
            // Nur wenn true, muss der Browser den Header x-amz-checksum-sha256 mitsenden
            'pruefsummen' => $this->dateien->partChecksums() && $summen !== [],
        ]);
    }

    public function abschliessen(Request $r): Response
    {
        $d = $r->json();
        $teile = [];
        foreach (is_array($d['teile'] ?? null) ? $d['teile'] : [] as $t) {
            if (!is_array($t) || !is_int($t['nummer'] ?? null) || !is_string($t['etag'] ?? null)) {
                throw ApiException::validation(['teile' => 'Liste aus {nummer, etag}.']);
            }
            $teile[] = ['nummer' => $t['nummer'], 'etag' => $t['etag']];
        }
        $sha = is_string($d['sha256'] ?? null) ? strtolower($d['sha256']) : '';
        return Response::json(['datei' => $this->dateien->abschliessen(self::kunde($r), self::id($r), $teile, $sha)]);
    }

    public function abbrechen(Request $r): Response
    {
        $this->dateien->abbrechen(self::kunde($r), self::id($r));
        return Response::noContent();
    }

    public function index(Request $r): Response
    {
        return Response::json(['dateien' => $this->dateien->list(self::kunde($r))]);
    }

    public function show(Request $r): Response
    {
        return Response::json(['datei' => $this->dateien->get(self::kunde($r), self::id($r))]);
    }

    public function update(Request $r): Response
    {
        return Response::json(['datei' => $this->dateien->update(self::kunde($r), self::id($r), $r->json())]);
    }

    public function delete(Request $r): Response
    {
        $this->dateien->delete(self::kunde($r), self::id($r));
        return Response::noContent();
    }
}
