<?php
declare(strict_types=1);

namespace Plinth\Api\Tests;

final class GeraeteTest extends ApiTestCase
{
    private string $session;
    private int $kundeId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->session = $this->loginAs('admin@kunde.de');
        $this->kundeId = (int) self::$db->query('SELECT id FROM kunden')->fetchColumn();
    }

    private function studio(string $method, string $path, ?array $json = null): \Plinth\Api\Http\Response
    {
        return $this->request($method, $path, $json, [], ['plinth_session' => $this->session]);
    }

    private function code(): string
    {
        return self::body($this->studio('GET', '/v1/kunde'))['kunde']['kundencode'];
    }

    private function registerDevice(string $code, string $name = 'Foyer links'): \Plinth\Api\Http\Response
    {
        return $this->request('POST', '/v1/player/registrieren', ['kundencode' => $code, 'name' => $name, 'appVersion' => '1.0.0']);
    }

    private function asDevice(string $token): \Plinth\Api\Http\Response
    {
        return $this->request('GET', '/v1/player/geraet', null, ['authorization' => "Bearer {$token}"]);
    }

    public function testKundencodeIsCreatedAndFormatted(): void
    {
        $code = $this->code();
        self::assertMatchesRegularExpression('/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/', $code);
        self::assertSame($code, $this->code(), 'stabil');
        self::assertDoesNotMatchRegularExpression('/[01OIL]/', $code);
    }

    public function testRegisterAndAuthenticateDevice(): void
    {
        // Eingabe ohne Bindestriche und klein geschrieben wird akzeptiert.
        $res = $this->registerDevice(strtolower(str_replace('-', ' ', $this->code())));
        self::assertSame(201, $res->status, $res->body);
        $token = self::body($res)['token'];

        $stored = self::$db->query('SELECT token_hash FROM geraete')->fetchColumn();
        self::assertSame(hash('sha256', $token), $stored);

        $me = $this->asDevice($token);
        self::assertSame(200, $me->status);
        self::assertSame('Foyer links', self::body($me)['geraet']['name']);
        self::assertSame('1.0.0', self::body($me)['geraet']['appVersion']);

        $list = self::body($this->studio('GET', '/v1/geraete'))['geraete'];
        self::assertCount(1, $list);
        self::assertNotNull($list[0]['zuletztGesehenAm']);
        self::assertArrayNotHasKey('token_hash', $list[0]);
    }

    public function testWrongCodeIsRejected(): void
    {
        $res = $this->registerDevice('AAAA-BBBB-CCCC');
        self::assertSame(401, $res->status);
        self::assertSame('invalid_code', self::body($res)['error']['code']);
        self::assertSame(422, $this->registerDevice('kurz')->status);
    }

    public function testRegistrationIsRateLimited(): void
    {
        for ($i = 0; $i < 10; $i++) {
            $this->registerDevice('AAAA-BBBB-CCCC');
        }
        self::assertSame(429, $this->registerDevice($this->code())->status);
    }

    public function testBlockAndUnblockDevice(): void
    {
        $reg = self::body($this->registerDevice($this->code()));
        $id = $reg['geraetId'];

        $res = $this->studio('PATCH', "/v1/geraete/{$id}", ['gesperrt' => true]);
        self::assertSame(200, $res->status, $res->body);
        self::assertTrue(self::body($res)['geraet']['gesperrt']);
        $blocked = $this->asDevice($reg['token']);
        self::assertSame(403, $blocked->status);
        self::assertSame('device_blocked', self::body($blocked)['error']['code']);

        $this->studio('PATCH', "/v1/geraete/{$id}", ['gesperrt' => false, 'name' => 'Foyer rechts']);
        self::assertSame(200, $this->asDevice($reg['token'])->status);
        self::assertSame('Foyer rechts', self::body($this->asDevice($reg['token']))['geraet']['name']);
    }

    public function testDeletedDeviceLosesAccess(): void
    {
        $reg = self::body($this->registerDevice($this->code()));
        self::assertSame(204, $this->studio('DELETE', "/v1/geraete/{$reg['geraetId']}")->status);
        self::assertSame(401, $this->asDevice($reg['token'])->status);
    }

    public function testRotatingCodeKeepsDevicesButInvalidatesOldCode(): void
    {
        $old = $this->code();
        $reg = self::body($this->registerDevice($old));
        $new = self::body($this->studio('POST', '/v1/kunde/kundencode', []))['kunde']['kundencode'];
        self::assertNotSame($old, $new);
        self::assertSame(401, $this->registerDevice($old)->status);
        self::assertSame(201, $this->registerDevice($new)->status);
        self::assertSame(200, $this->asDevice($reg['token'])->status);
    }

    public function testCustomersCannotSeeEachOthersDevices(): void
    {
        $reg = self::body($this->registerDevice($this->code()));
        $other = $this->loginAs('fremd@anderer.de');
        $cookies = ['plinth_session' => $other];

        self::assertSame([], self::body($this->request('GET', '/v1/geraete', null, [], $cookies))['geraete']);
        self::assertSame(404, $this->request('PATCH', "/v1/geraete/{$reg['geraetId']}", ['gesperrt' => true], [], $cookies)->status);
        self::assertSame(404, $this->request('DELETE', "/v1/geraete/{$reg['geraetId']}", [], [], $cookies)->status);
        self::assertSame(200, $this->asDevice($reg['token'])->status);
    }

    public function testInactiveCustomerBlocksDevicesAndRegistration(): void
    {
        $code = $this->code();
        $reg = self::body($this->registerDevice($code));
        self::$db->exec('UPDATE kunden SET aktiv = 0');
        self::assertSame(403, $this->asDevice($reg['token'])->status);
        self::assertSame(401, $this->registerDevice($code)->status);
    }

    public function testStudioEndpointsNeedLogin(): void
    {
        self::assertSame(401, $this->request('GET', '/v1/geraete')->status);
        self::assertSame(401, $this->request('GET', '/v1/kunde')->status);
    }

    public function testDeviceEndpointNeedsToken(): void
    {
        self::assertSame(401, $this->request('GET', '/v1/player/geraet')->status);
        self::assertSame(401, $this->asDevice('ungueltiges-token-1234567890')->status);
    }

    public function testValidationOnUpdate(): void
    {
        $reg = self::body($this->registerDevice($this->code()));
        $res = $this->studio('PATCH', "/v1/geraete/{$reg['geraetId']}", ['gesperrt' => 'ja', 'name' => '', 'projektId' => 999]);
        self::assertSame(422, $res->status);
        self::assertSame(['name', 'gesperrt'], array_keys(self::body($res)['error']['details']['fields']));
        self::assertSame(422, $this->studio('PATCH', "/v1/geraete/{$reg['geraetId']}", ['projektId' => 999])->status);
    }
}
