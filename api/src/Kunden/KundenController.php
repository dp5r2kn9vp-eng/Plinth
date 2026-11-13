<?php
declare(strict_types=1);

namespace Plinth\Api\Kunden;

use Plinth\Api\Http\Request;
use Plinth\Api\Http\Response;

final class KundenController
{
    public function __construct(private KundenService $kunden)
    {
    }

    public function show(Request $request): Response
    {
        return Response::json(['kunde' => $this->kunden->get($request->attributes['user']['kundeId'])]);
    }

    public function rotateCode(Request $request): Response
    {
        $kundeId = $request->attributes['user']['kundeId'];
        $this->kunden->rotateCode($kundeId);
        return Response::json(['kunde' => $this->kunden->get($kundeId)]);
    }
}
