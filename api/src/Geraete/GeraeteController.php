<?php
declare(strict_types=1);

namespace Plinth\Api\Geraete;

use Plinth\Api\Http\ApiException;
use Plinth\Api\Http\Request;
use Plinth\Api\Http\Response;
use Plinth\Api\Kunden\KundenService;
use Plinth\Api\RateLimiter;

final class GeraeteController
{
    public function __construct(
        private GeraeteService $geraete,
        private KundenService $kunden,
        private RateLimiter $limiter,
    ) {
    }

    // ---------- Player ----------

    /** Kundencode gegen Gerätetoken tauschen. */
    public function register(Request $request): Response
    {
        $this->limiter->hit('register:ip:' . $request->ip, 10, 900);

        $data = $request->json();
        $code = is_string($data['kundencode'] ?? null) ? $data['kundencode'] : '';
        $name = is_string($data['name'] ?? null) ? trim($data['name']) : '';
        $appVersion = is_string($data['appVersion'] ?? null) ? substr($data['appVersion'], 0, 40) : null;

        $errors = [];
        if (strlen(KundenService::normalizeCode($code)) !== 12) {
            $errors['kundencode'] = 'Kundencode hat 12 Zeichen.';
        }
        if ($name === '' || mb_strlen($name) > 190) {
            $errors['name'] = 'Gerätename fehlt oder ist zu lang.';
        }
        if ($errors !== []) {
            throw ApiException::validation($errors);
        }

        $kundeId = $this->kunden->findActiveByCode($code);
        if ($kundeId === null) {
            throw new ApiException(401, 'invalid_code', 'Kundencode ist ungültig.');
        }
        $device = $this->geraete->register($kundeId, $name, $appVersion, $request->ip);
        return Response::json(['geraetId' => $device['id'], 'token' => $device['token']], 201);
    }

    public function self(Request $request): Response
    {
        return Response::json(['geraet' => GeraeteService::present($this->requireDevice($request))]);
    }

    /**
     * Für Player-Endpunkte: Authorization: Bearer <token>.
     *
     * @return array<string,mixed>
     */
    public function requireDevice(Request $request): array
    {
        $auth = $request->header('authorization') ?? '';
        if (!preg_match('/^Bearer\s+([A-Za-z0-9_-]{20,100})$/', $auth, $m)) {
            throw new ApiException(401, 'device_unknown', 'Gerätetoken fehlt.');
        }
        // Großzügig für Polling alle 30 s, bremst aber Fehlkonfigurationen und Missbrauch.
        $this->limiter->hit('device:' . hash('sha256', $m[1]), 300, 900);
        $device = $this->geraete->authenticate($m[1], $request->ip, $request->header('x-plinth-version'));
        $request->attributes['device'] = $device;
        return $device;
    }

    // ---------- Studio ----------

    public function index(Request $request): Response
    {
        return Response::json(['geraete' => $this->geraete->list($request->attributes['user']['kundeId'])]);
    }

    public function update(Request $request): Response
    {
        $data = $request->json();
        $changes = [];
        $errors = [];
        if (array_key_exists('name', $data)) {
            $name = is_string($data['name']) ? trim($data['name']) : '';
            $name === '' || mb_strlen($name) > 190 ? $errors['name'] = 'Name fehlt oder ist zu lang.' : $changes['name'] = $name;
        }
        if (array_key_exists('gesperrt', $data)) {
            is_bool($data['gesperrt']) ? $changes['gesperrt'] = $data['gesperrt'] : $errors['gesperrt'] = 'Muss true oder false sein.';
        }
        if (array_key_exists('projektId', $data)) {
            is_int($data['projektId']) || $data['projektId'] === null
                ? $changes['projektId'] = $data['projektId']
                : $errors['projektId'] = 'Muss eine Projekt-ID oder null sein.';
        }
        if ($errors !== []) {
            throw ApiException::validation($errors);
        }
        $device = $this->geraete->update($request->attributes['user']['kundeId'], (int) $request->params['id'], $changes);
        return Response::json(['geraet' => $device]);
    }

    public function delete(Request $request): Response
    {
        $this->geraete->delete($request->attributes['user']['kundeId'], (int) $request->params['id']);
        return Response::noContent();
    }
}
