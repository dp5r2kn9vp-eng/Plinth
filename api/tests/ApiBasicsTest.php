<?php
declare(strict_types=1);

namespace Plinth\Api\Tests;

final class ApiBasicsTest extends ApiTestCase
{
    public function testHealth(): void
    {
        $res = $this->request('GET', '/v1/health');
        self::assertSame(200, $res->status);
        self::assertSame(['status' => 'ok', 'version' => 'v1'], self::body($res));
        self::assertMatchesRegularExpression('/^[0-9a-f]{16}$/', $res->headers['X-Request-Id']);
        self::assertSame('no-store', $res->headers['Cache-Control']);
    }

    public function testUnknownEndpointUsesErrorFormat(): void
    {
        $res = $this->request('GET', '/v1/gibt-es-nicht');
        self::assertSame(404, $res->status);
        $error = self::body($res)['error'];
        self::assertSame('not_found', $error['code']);
        self::assertSame($res->headers['X-Request-Id'], $error['requestId']);
        self::assertArrayHasKey('message', $error);
    }

    public function testWrongMethod(): void
    {
        $res = $this->request('GET', '/v1/auth/login');
        self::assertSame(405, $res->status);
        self::assertSame('POST', $res->headers['Allow']);
    }

    public function testPostRequiresJson(): void
    {
        $res = $this->request('POST', '/v1/auth/login', null, ['content-type' => 'application/x-www-form-urlencoded']);
        self::assertSame(415, $res->status);
        self::assertSame('unsupported_media_type', self::body($res)['error']['code']);
    }

    public function testInvalidJson(): void
    {
        $res = $this->app->handle(new \Plinth\Api\Http\Request(
            'POST', '/v1/auth/login', ['content-type' => 'application/json'], '{kaputt',
        ));
        self::assertSame(400, $res->status);
        self::assertSame('invalid_json', self::body($res)['error']['code']);
    }

    public function testForeignOriginIsRejected(): void
    {
        $res = $this->request('POST', '/v1/auth/login', ['email' => 'a@b.de', 'password' => 'x'], ['origin' => 'https://evil.example']);
        self::assertSame(403, $res->status);
    }

    public function testInternalErrorsDoNotLeakDetails(): void
    {
        $app = new \Plinth\Api\App(self::config(), new \Plinth\Api\Logger(null), fn () => throw new \RuntimeException('DB-Passwort xyz'));
        $res = $app->handle(new \Plinth\Api\Http\Request('GET', '/v1/auth/me'));
        self::assertSame(500, $res->status);
        self::assertSame('Interner Fehler.', self::body($res)['error']['message']);
    }
}
