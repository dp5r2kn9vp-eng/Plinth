<?php
declare(strict_types=1);

namespace Plinth\Api\Tests;

final class AuthTest extends ApiTestCase
{
    private const PW = 'richtig-geheim-123';

    public function testLoginMeLogout(): void
    {
        $this->createUser('anna@kunde.de', self::PW);

        $res = $this->request('POST', '/v1/auth/login', ['email' => ' Anna@Kunde.de ', 'password' => self::PW]);
        self::assertSame(200, $res->status, $res->body);
        self::assertSame('anna@kunde.de', self::body($res)['user']['email']);

        $token = self::sessionCookie($res);
        self::assertNotNull($token);
        $cookie = $res->cookies[0];
        self::assertStringContainsString('HttpOnly', $cookie);
        self::assertStringContainsString('Secure', $cookie);
        self::assertStringContainsString('SameSite=Strict', $cookie);
        self::assertStringContainsString('Path=/api', $cookie);
        self::assertStringNotContainsString('Expires', $cookie, 'Ohne "Angemeldet bleiben" nur Sitzungscookie');

        // Nur der Hash liegt in der Datenbank.
        $stored = self::$db->query('SELECT token_hash FROM auth_sessions')->fetchColumn();
        self::assertSame(hash('sha256', $token), $stored);

        $me = $this->request('GET', '/v1/auth/me', null, [], ['plinth_session' => $token]);
        self::assertSame(200, $me->status);
        self::assertSame('anna@kunde.de', self::body($me)['user']['email']);

        $out = $this->request('POST', '/v1/auth/logout', [], [], ['plinth_session' => $token]);
        self::assertSame(204, $out->status);
        self::assertStringContainsString('Max-Age=0', $out->cookies[0]);

        $me = $this->request('GET', '/v1/auth/me', null, [], ['plinth_session' => $token]);
        self::assertSame(401, $me->status);
    }

    public function testRememberSetsPersistentCookie(): void
    {
        $this->createUser('anna@kunde.de', self::PW);
        $res = $this->request('POST', '/v1/auth/login', ['email' => 'anna@kunde.de', 'password' => self::PW, 'remember' => true]);
        self::assertSame(200, $res->status);
        self::assertStringContainsString('Expires=', $res->cookies[0]);
    }

    public function testPasswordIsArgon2id(): void
    {
        $this->createUser('anna@kunde.de', self::PW);
        $hash = self::$db->query('SELECT passwort_hash FROM benutzer')->fetchColumn();
        self::assertStringStartsWith('$argon2id$', $hash);
    }

    public function testWrongPasswordAndUnknownUserLookTheSame(): void
    {
        $this->createUser('anna@kunde.de', self::PW);
        $wrong = $this->request('POST', '/v1/auth/login', ['email' => 'anna@kunde.de', 'password' => 'falsch-falsch']);
        $unknown = $this->request('POST', '/v1/auth/login', ['email' => 'niemand@kunde.de', 'password' => 'falsch-falsch']);

        self::assertSame(401, $wrong->status);
        self::assertSame(401, $unknown->status);
        self::assertSame(self::body($wrong)['error']['code'], self::body($unknown)['error']['code']);
        self::assertSame(self::body($wrong)['error']['message'], self::body($unknown)['error']['message']);
        self::assertSame([], $wrong->cookies);
    }

    public function testInactiveUserOrCustomerCannotLogin(): void
    {
        $this->createUser('weg@kunde.de', self::PW, aktiv: false);
        $this->createUser('gesperrt@kunde.de', self::PW, kundeAktiv: false);
        self::assertSame(401, $this->request('POST', '/v1/auth/login', ['email' => 'weg@kunde.de', 'password' => self::PW])->status);
        self::assertSame(401, $this->request('POST', '/v1/auth/login', ['email' => 'gesperrt@kunde.de', 'password' => self::PW])->status);
    }

    public function testDeactivatingUserEndsExistingSession(): void
    {
        $id = $this->createUser('anna@kunde.de', self::PW);
        $token = self::sessionCookie($this->request('POST', '/v1/auth/login', ['email' => 'anna@kunde.de', 'password' => self::PW]));
        self::$db->prepare('UPDATE benutzer SET aktiv = 0 WHERE id = ?')->execute([$id]);
        self::assertSame(401, $this->request('GET', '/v1/auth/me', null, [], ['plinth_session' => $token])->status);
    }

    public function testExpiredSessionIsRejected(): void
    {
        $this->createUser('anna@kunde.de', self::PW);
        $token = self::sessionCookie($this->request('POST', '/v1/auth/login', ['email' => 'anna@kunde.de', 'password' => self::PW]));
        self::$db->exec('UPDATE auth_sessions SET laeuft_ab_am = UTC_TIMESTAMP() - INTERVAL 1 SECOND');
        self::assertSame(401, $this->request('GET', '/v1/auth/me', null, [], ['plinth_session' => $token])->status);
    }

    public function testMissingFields(): void
    {
        $res = $this->request('POST', '/v1/auth/login', ['email' => '']);
        self::assertSame(422, $res->status);
        self::assertSame(['email', 'password'], array_keys(self::body($res)['error']['details']['fields']));
    }

    public function testLoginIsRateLimitedPerIpAndEmail(): void
    {
        $this->createUser('anna@kunde.de', self::PW);
        for ($i = 0; $i < 5; $i++) {
            self::assertSame(401, $this->request('POST', '/v1/auth/login', ['email' => 'anna@kunde.de', 'password' => 'falsch'])->status);
        }
        $blocked = $this->request('POST', '/v1/auth/login', ['email' => 'anna@kunde.de', 'password' => self::PW]);
        self::assertSame(429, $blocked->status);
        self::assertGreaterThan(0, (int) $blocked->headers['Retry-After']);

        // Andere IP ist davon nicht betroffen.
        $other = $this->request('POST', '/v1/auth/login', ['email' => 'anna@kunde.de', 'password' => self::PW], ip: '198.51.100.7');
        self::assertSame(200, $other->status);
    }

    public function testRateLimitWindowExpires(): void
    {
        $this->createUser('anna@kunde.de', self::PW);
        for ($i = 0; $i < 6; $i++) {
            $this->request('POST', '/v1/auth/login', ['email' => 'anna@kunde.de', 'password' => 'falsch']);
        }
        self::$db->exec('UPDATE rate_limits SET window_start = UTC_TIMESTAMP() - INTERVAL 16 MINUTE');
        self::assertSame(200, $this->request('POST', '/v1/auth/login', ['email' => 'anna@kunde.de', 'password' => self::PW])->status);
    }

    public function testSuccessfulLoginResetsCounter(): void
    {
        $this->createUser('anna@kunde.de', self::PW);
        for ($i = 0; $i < 4; $i++) {
            $this->request('POST', '/v1/auth/login', ['email' => 'anna@kunde.de', 'password' => 'falsch']);
        }
        self::assertSame(200, $this->request('POST', '/v1/auth/login', ['email' => 'anna@kunde.de', 'password' => self::PW])->status);
        for ($i = 0; $i < 4; $i++) {
            self::assertSame(401, $this->request('POST', '/v1/auth/login', ['email' => 'anna@kunde.de', 'password' => 'falsch'])->status);
        }
    }

    public function testNewLoginReplacesOldSessionOfSameBrowser(): void
    {
        $this->createUser('anna@kunde.de', self::PW);
        $old = self::sessionCookie($this->request('POST', '/v1/auth/login', ['email' => 'anna@kunde.de', 'password' => self::PW]));
        $new = self::sessionCookie($this->request('POST', '/v1/auth/login', ['email' => 'anna@kunde.de', 'password' => self::PW], [], ['plinth_session' => $old]));
        self::assertNotSame($old, $new);
        self::assertSame(401, $this->request('GET', '/v1/auth/me', null, [], ['plinth_session' => $old])->status);
        self::assertSame(200, $this->request('GET', '/v1/auth/me', null, [], ['plinth_session' => $new])->status);
    }
}
