<?php
declare(strict_types=1);

namespace Plinth\Api\Tests;

use Plinth\Api\Http\Response;

final class ProjekteTest extends ApiTestCase
{
    private string $session;

    protected function setUp(): void
    {
        parent::setUp();
        $this->session = $this->loginAs('p@kunde.de');
    }

    private function studio(string $method, string $path, ?array $json = null, ?string $session = null): Response
    {
        return $this->request($method, $path, $json, [], ['plinth_session' => $session ?? $this->session]);
    }

    private function createProject(string $ausrichtung = 'landscape'): array
    {
        $res = $this->studio('POST', '/v1/projekte', ['name' => 'Foyer', 'ausrichtung' => $ausrichtung]);
        self::assertSame(201, $res->status, $res->body);
        return self::body($res)['projekt'];
    }

    public function testCreateProjectWithStartDraft(): void
    {
        $p = $this->createProject('portrait');
        self::assertSame(['Foyer', 'portrait', null], [$p['name'], $p['ausrichtung'], $p['revision']]);
        $draft = self::body($this->studio('GET', "/v1/projekte/{$p['id']}/entwurf"));
        self::assertSame(1, $draft['version']);
        self::assertSame(['orientation' => 'portrait', 'width' => 1080, 'height' => 1920], $draft['layout']['format']);
        self::assertCount(1, self::body($this->studio('GET', '/v1/projekte'))['projekte']);
    }

    public function testSaveDraftAndVersionConflict(): void
    {
        $p = $this->createProject();
        $draft = self::body($this->studio('GET', "/v1/projekte/{$p['id']}/entwurf"));
        $layout = $draft['layout'];
        $layout['pages'][0]['elements'][] = ['id' => 't1', 'type' => 'text', 'x' => 10, 'y' => 10, 'w' => 500, 'h' => 100, 'text' => 'Hallo'];

        $saved = $this->studio('PUT', "/v1/projekte/{$p['id']}/entwurf", ['layout' => $layout, 'version' => 1]);
        self::assertSame(200, $saved->status, $saved->body);
        self::assertSame(2, self::body($saved)['version']);
        self::assertSame('Hallo', self::body($saved)['layout']['pages'][0]['elements'][0]['text']);

        // Zweiter Tab mit altem Stand
        $conflict = $this->studio('PUT', "/v1/projekte/{$p['id']}/entwurf", ['layout' => $layout, 'version' => 1]);
        self::assertSame(409, $conflict->status);
        self::assertSame(2, self::body($conflict)['error']['details']['version']);
    }

    public function testInvalidLayoutIsRejected(): void
    {
        $p = $this->createProject();
        $layout = self::body($this->studio('GET', "/v1/projekte/{$p['id']}/entwurf"))['layout'];
        $layout['pages'][0]['elements'][] = ['id' => 'x', 'type' => 'script', 'x' => 0, 'y' => 0, 'w' => 1, 'h' => 1];
        $res = $this->studio('PUT', "/v1/projekte/{$p['id']}/entwurf", ['layout' => $layout, 'version' => 1]);
        self::assertSame(422, $res->status);
        self::assertSame('invalid_layout', self::body($res)['error']['code']);
        self::assertNotEmpty(self::body($res)['error']['details']['errors']);
    }

    public function testChangingOrientationUpdatesProject(): void
    {
        $p = $this->createProject();
        $layout = self::body($this->studio('GET', "/v1/projekte/{$p['id']}/entwurf"))['layout'];
        $layout['format'] = ['orientation' => 'portrait', 'width' => 1080, 'height' => 1920];
        self::assertSame(200, $this->studio('PUT', "/v1/projekte/{$p['id']}/entwurf", ['layout' => $layout, 'version' => 1])->status);
        self::assertSame('portrait', self::body($this->studio('GET', '/v1/projekte'))['projekte'][0]['ausrichtung']);
    }

    public function testRenameAndValidation(): void
    {
        $p = $this->createProject();
        self::assertSame('Eingang', self::body($this->studio('PATCH', "/v1/projekte/{$p['id']}", ['name' => 'Eingang']))['projekt']['name']);
        self::assertSame(422, $this->studio('POST', '/v1/projekte', ['name' => '', 'ausrichtung' => 'diagonal'])->status);
    }

    public function testOtherCustomersCannotAccessProjects(): void
    {
        $p = $this->createProject();
        $fremd = $this->loginAs('fremd@anderer.de');
        self::assertSame([], self::body($this->studio('GET', '/v1/projekte', null, $fremd))['projekte']);
        self::assertSame(404, $this->studio('GET', "/v1/projekte/{$p['id']}/entwurf", null, $fremd)->status);
        self::assertSame(404, $this->studio('PUT', "/v1/projekte/{$p['id']}/entwurf", ['layout' => [], 'version' => 1], $fremd)->status);
        self::assertSame(404, $this->studio('POST', "/v1/projekte/{$p['id']}/veroeffentlichen", [], $fremd)->status);
    }
}
