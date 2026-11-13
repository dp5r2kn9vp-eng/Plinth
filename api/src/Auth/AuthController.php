<?php
declare(strict_types=1);

namespace Plinth\Api\Auth;

use Plinth\Api\Http\ApiException;
use Plinth\Api\Http\Request;
use Plinth\Api\Http\Response;
use Plinth\Api\RateLimiter;

final class AuthController
{
    public const COOKIE = 'plinth_session';

    /** Login-Limits: pro IP insgesamt und pro IP+E-Mail (jeweils 15 Minuten). */
    private const LIMIT_IP = 30;
    private const LIMIT_IP_EMAIL = 5;
    private const WINDOW = 900;

    public function __construct(
        private SessionService $sessions,
        private RateLimiter $limiter,
        private string $cookiePath,
        private bool $cookieSecure,
    ) {
    }

    public function login(Request $request): Response
    {
        $data = $request->json();
        $email = is_string($data['email'] ?? null) ? mb_strtolower(trim($data['email'])) : '';
        $password = is_string($data['password'] ?? null) ? $data['password'] : '';
        $remember = ($data['remember'] ?? false) === true;

        $errors = [];
        if ($email === '') {
            $errors['email'] = 'E-Mail fehlt.';
        }
        if ($password === '') {
            $errors['password'] = 'Passwort fehlt.';
        }
        if ($errors !== []) {
            throw ApiException::validation($errors);
        }

        $this->limiter->hit('login:ip:' . $request->ip, self::LIMIT_IP, self::WINDOW);
        $this->limiter->hit('login:ip-email:' . $request->ip . ':' . $email, self::LIMIT_IP_EMAIL, self::WINDOW);

        // Überlange Passwörter nicht hashen (Schutz vor teuren Requests).
        $user = strlen($password) <= 1024 ? $this->sessions->verifyCredentials($email, $password) : null;
        if ($user === null) {
            throw new ApiException(401, 'invalid_credentials', 'E-Mail oder Passwort ist falsch.');
        }

        $this->limiter->reset('login:ip-email:' . $request->ip . ':' . $email);

        // Eine evtl. vorhandene alte Sitzung dieses Browsers beenden (keine Session-Fixation).
        if ($old = $request->cookie(self::COOKIE)) {
            $this->sessions->destroy($old);
        }

        $session = $this->sessions->create((int) $user['id'], $remember, $request->ip, $request->header('user-agent') ?? '');

        return Response::json([
            'user' => [
                'id' => (int) $user['id'],
                'kundeId' => (int) $user['kunde_id'],
                'email' => $user['email'],
                'name' => $user['name'],
            ],
            'expiresAt' => gmdate('Y-m-d\TH:i:s\Z', $session['expiresAt']),
        ])->withCookie(self::COOKIE, $session['token'], [
            // Ohne "Angemeldet bleiben" ein Browser-Sitzungscookie; serverseitig läuft es trotzdem ab.
            'expires' => $remember ? $session['expiresAt'] : null,
            'path' => $this->cookiePath,
            'secure' => $this->cookieSecure,
        ]);
    }

    public function logout(Request $request): Response
    {
        if ($token = $request->cookie(self::COOKIE)) {
            $this->sessions->destroy($token);
        }
        return Response::noContent()->withCookie(self::COOKIE, '', [
            'expires' => 1,
            'path' => $this->cookiePath,
            'secure' => $this->cookieSecure,
        ]);
    }

    public function me(Request $request): Response
    {
        return Response::json(['user' => $this->requireUser($request)]);
    }

    /**
     * Für geschützte Endpunkte: liefert den angemeldeten Benutzer oder wirft 401.
     *
     * @return array{id:int,kundeId:int,email:string,name:string}
     */
    public function requireUser(Request $request): array
    {
        $token = $request->cookie(self::COOKIE);
        $user = $token ? $this->sessions->userForToken($token) : null;
        if ($user === null) {
            throw ApiException::unauthorized();
        }
        $request->attributes['user'] = $user;
        return $user;
    }
}
