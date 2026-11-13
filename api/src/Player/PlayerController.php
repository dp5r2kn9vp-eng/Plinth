<?php
declare(strict_types=1);

namespace Plinth\Api\Player;

use Plinth\Api\Geraete\GeraeteController;
use Plinth\Api\Http\ApiException;
use Plinth\Api\Http\Request;
use Plinth\Api\Http\Response;

final class PlayerController
{
    public function __construct(private PlayerService $player, private GeraeteController $geraete)
    {
    }

    /**
     * Leichte Abfrage für das Polling (alle 30–60 s): nur die Revisionsnummer.
     * Mit If-None-Match antwortet die API 304 ohne Inhalt, solange sich nichts geändert hat.
     */
    public function revision(Request $request): Response
    {
        $device = $this->geraete->requireDevice($request);
        $projektId = $this->player->projektId($device);
        $revision = $this->player->currentRevision($projektId);
        $etag = sprintf('"p%s-r%s"', $projektId ?? 0, $revision ?? 0);

        if ($request->header('if-none-match') === $etag) {
            $res = new Response(304);
        } else {
            $res = Response::json(['revision' => $revision, 'projektId' => $projektId]);
        }
        $res->headers['ETag'] = $etag;
        return $res;
    }

    public function manifest(Request $request): Response
    {
        $device = $this->geraete->requireDevice($request);
        $nummer = isset($request->query['revision']) ? (int) $request->query['revision'] : null;
        $data = $this->player->manifest($device, $nummer);
        if ($data === null) {
            throw new ApiException(404, 'no_revision', 'Es wurde noch nichts veröffentlicht.');
        }
        return Response::json($data);
    }

    /** Gerät meldet, welche Revision es vollständig geladen hat und anzeigt. */
    public function status(Request $request): Response
    {
        $device = $this->geraete->requireDevice($request);
        $data = $request->json();
        $rev = $data['geladeneRevision'] ?? null;
        if ($rev !== null && (!is_int($rev) || $rev < 1)) {
            throw ApiException::validation(['geladeneRevision' => 'Positive ganze Zahl oder null.']);
        }
        $this->player->reportStatus((int) $device['id'], $rev);
        return Response::noContent();
    }
}
