<?php
declare(strict_types=1);

namespace Plinth\Api\Tests;

use Plinth\Api\App;
use Plinth\Api\Http\Response;
use Plinth\Api\Logger;
use Plinth\Api\Schema\SchemaValidator;

final class PublishTest extends ApiTestCase
{
    use StorageTestTrait;

    private string $session;
    private int $kundeId;
    private int $projektId;

    protected function setUp(): void
    {
        parent::setUp();
        $storage = self::storage();
        $this->app = new App(self::config(), new Logger(null), fn () => self::$db, fn () => $storage);
        $this->session = $this->loginAs('pub@kunde.de');
        $this->kundeId = (int) self::$db->query('SELECT id FROM kunden')->fetchColumn();
        $this->projektId = self::body($this->studio('POST', '/v1/projekte', ['name' => 'Foyer', 'ausrichtung' => 'landscape']))['projekt']['id'];
    }

    private function studio(string $method, string $path, ?array $json = null): Response
    {
        return $this->request($method, $path, $json, [], ['plinth_session' => $this->session]);
    }

    /** Legt eine fertige Datei direkt im Speicher und in der DB an. */
    private function file(string $mime, string $data, string $status = 'fertig', ?int $poster = null): string
    {
        $key = 'kunden/' . $this->kundeId . '/' . bin2hex(random_bytes(8));
        self::$storage->client()->putObject(['Bucket' => self::$storage->bucket(), 'Key' => $key, 'Body' => $data]);
        self::$db->prepare('INSERT INTO dateien (kunde_id, name, mime, groesse, sha256, speicher_schluessel, status, vorschau_datei_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([$this->kundeId, 'datei', $mime, strlen($data), hash('sha256', $data), $key, $status, $poster]);
        return 'f' . self::$db->lastInsertId();
    }

    private function setLayout(callable $change): void
    {
        $draft = self::body($this->studio('GET', "/v1/projekte/{$this->projektId}/entwurf"));
        $layout = $change($draft['layout']);
        $res = $this->studio('PUT', "/v1/projekte/{$this->projektId}/entwurf", ['layout' => $layout, 'version' => $draft['version']]);
        self::assertSame(200, $res->status, $res->body);
    }

    private function device(): string
    {
        $code = self::body($this->studio('GET', '/v1/kunde'))['kunde']['kundencode'];
        return self::body($this->request('POST', '/v1/player/registrieren', ['kundencode' => $code, 'name' => 'Gerät']))['token'];
    }

    private function asDevice(string $token, string $method, string $path, ?array $json = null, array $headers = []): Response
    {
        return $this->request($method, $path, $json, ['authorization' => "Bearer {$token}"] + $headers);
    }

    private function layoutWithMedia(string $bg, string $video): callable
    {
        return function (array $l) use ($bg, $video) {
            $l['pages'][0]['background'] = ['color' => '#000000', 'image' => $bg, 'fit' => 'cover'];
            $l['pages'][0]['elements'][] = ['id' => 'v', 'type' => 'thumbnail', 'x' => 100, 'y' => 100, 'w' => 800, 'h' => 450, 'video' => $video, 'title' => 'Film'];
            return $l;
        };
    }

    public function testPublishCreatesImmutableManifestAndPlayerCanFetchIt(): void
    {
        $videoData = random_bytes(3000);
        $poster = $this->file('image/jpeg', random_bytes(200));
        $bg = $this->file('image/png', random_bytes(100));
        $video = $this->file('video/mp4', $videoData, poster: (int) substr($poster, 1));
        $this->setLayout($this->layoutWithMedia($bg, $video));

        $res = $this->studio('POST', "/v1/projekte/{$this->projektId}/veroeffentlichen", []);
        self::assertSame(201, $res->status, $res->body);
        $rev = self::body($res)['revision'];
        self::assertSame([1, 3, 3300], [$rev['nummer'], $rev['dateien'], $rev['groesse']]);

        // Player: Revision, ETag/304, Manifest mit Downloads
        $token = $this->device();
        $r = $this->asDevice($token, 'GET', '/v1/player/revision');
        self::assertSame(1, self::body($r)['revision']);
        self::assertSame(304, $this->asDevice($token, 'GET', '/v1/player/revision', null, ['if-none-match' => $r->headers['ETag']])->status);

        $m = self::body($this->asDevice($token, 'GET', '/v1/player/manifest'));
        self::assertSame([], (new SchemaValidator())->validateManifest($m['manifest']));
        self::assertSame(1, $m['manifest']['revision']);
        self::assertSame($this->projektId, $m['projektId']);
        // Standbild des Videos wurde automatisch als Poster eingetragen
        self::assertSame($poster, $m['manifest']['layout']['pages'][0]['elements'][0]['poster']);
        self::assertEqualsCanonicalizing(['image/png', 'image/jpeg', 'video/mp4'], array_column($m['manifest']['files'], 'mime'));

        $videoFile = array_values(array_filter($m['manifest']['files'], fn ($f) => $f['id'] === $video))[0];
        self::assertSame('media/' . hash('sha256', $videoData) . '.mp4', $videoFile['path']);
        [$status, $body] = self::get($m['downloads'][$video]);
        self::assertSame(200, $status);
        self::assertSame($videoFile['sha256'], hash('sha256', $body));

        // Neue Veröffentlichung → neue Nummer, altes Manifest unverändert
        $this->setLayout(function ($l) {
            $l['pages'][0]['elements'][0]['title'] = 'Neu';
            return $l;
        });
        self::assertSame(2, self::body($this->studio('POST', "/v1/projekte/{$this->projektId}/veroeffentlichen", []))['revision']['nummer']);
        self::assertSame(200, $this->asDevice($token, 'GET', '/v1/player/revision', null, ['if-none-match' => $r->headers['ETag']])->status);
        $old = self::body($this->asDevice($token, 'GET', '/v1/player/manifest?revision=1'));
        self::assertSame('Film', $old['manifest']['layout']['pages'][0]['elements'][0]['title']);

        $revs = self::body($this->studio('GET', "/v1/projekte/{$this->projektId}/revisionen"))['revisionen'];
        self::assertSame([2, 1], array_column($revs, 'nummer'));
        self::assertSame(2, self::body($this->studio('GET', '/v1/projekte'))['projekte'][0]['revision']);
    }

    public function testFilesStillUploadingBlockPublish(): void
    {
        $bg = $this->file('image/png', random_bytes(100), 'upload');
        $video = $this->file('video/mp4', random_bytes(100));
        $this->setLayout($this->layoutWithMedia($bg, $video));
        $res = $this->studio('POST', "/v1/projekte/{$this->projektId}/veroeffentlichen", []);
        self::assertSame(422, $res->status);
        self::assertSame('files_not_ready', self::body($res)['error']['code']);
        self::assertArrayHasKey($bg, self::body($res)['error']['details']['dateien']);
        self::assertSame(0, (int) self::$db->query('SELECT COUNT(*) FROM revisionen')->fetchColumn(), 'nichts halb veröffentlicht');
    }

    public function testFileMissingInStorageBlocksPublish(): void
    {
        $bg = $this->file('image/png', random_bytes(100));
        $video = $this->file('video/mp4', random_bytes(100));
        $key = self::$db->query('SELECT speicher_schluessel FROM dateien WHERE id = ' . substr($video, 1))->fetchColumn();
        self::$storage->delete($key);
        $this->setLayout($this->layoutWithMedia($bg, $video));
        self::assertSame(422, $this->studio('POST', "/v1/projekte/{$this->projektId}/veroeffentlichen", [])->status);
        self::assertSame(0, (int) self::$db->query('SELECT COUNT(*) FROM revisionen')->fetchColumn());
    }

    public function testForeignFilesCannotBePublished(): void
    {
        self::$db->prepare('INSERT INTO kunden (name) VALUES (?)')->execute(['Fremd']);
        $fremdKunde = (int) self::$db->lastInsertId();
        self::$db->prepare("INSERT INTO dateien (kunde_id, name, mime, groesse, sha256, speicher_schluessel, status) VALUES (?, 'x', 'image/png', 1, ?, 'fremd/x', 'fertig')")
            ->execute([$fremdKunde, str_repeat('a', 64)]);
        $fremdeDatei = 'f' . self::$db->lastInsertId();
        $this->setLayout($this->layoutWithMedia($fremdeDatei, $this->file('video/mp4', 'v')));
        self::assertSame(422, $this->studio('POST', "/v1/projekte/{$this->projektId}/veroeffentlichen", [])->status);
    }

    public function testScheduleOptionsAreValidated(): void
    {
        $res = $this->studio('POST', "/v1/projekte/{$this->projektId}/veroeffentlichen", ['gueltigAb' => '2026-12-02T08:00', 'gueltigBis' => '2026-12-01T08:00']);
        self::assertSame(422, $res->status);
        $res = $this->studio('POST', "/v1/projekte/{$this->projektId}/veroeffentlichen", ['gueltigAb' => '2026-12-01T08:00', 'prioritaet' => 5]);
        self::assertSame(201, $res->status, $res->body);
        $m = json_decode((string) self::$db->query('SELECT manifest FROM revisionen')->fetchColumn(), true);
        self::assertSame(['2026-12-01T08:00', null, 5], [$m['validFrom'], $m['validTo'], $m['priority']]);
        self::assertSame(1, (int) self::$db->query('SELECT COUNT(*) FROM zeitplaene')->fetchColumn());
    }

    public function testPlayerWithoutPublicationAndStatusReport(): void
    {
        $token = $this->device();
        self::assertNull(self::body($this->asDevice($token, 'GET', '/v1/player/revision'))['revision']);
        self::assertSame('no_revision', self::body($this->asDevice($token, 'GET', '/v1/player/manifest'))['error']['code']);

        $this->studio('POST', "/v1/projekte/{$this->projektId}/veroeffentlichen", []);
        self::assertSame(204, $this->asDevice($token, 'POST', '/v1/player/status', ['geladeneRevision' => 1])->status);
        self::assertSame(1, self::body($this->studio('GET', '/v1/geraete'))['geraete'][0]['geladeneRevision']);
        self::assertSame(422, $this->asDevice($token, 'POST', '/v1/player/status', ['geladeneRevision' => 'eins'])->status);
    }

    public function testDeviceFollowsAssignedProject(): void
    {
        $token = $this->device();
        $zweites = self::body($this->studio('POST', '/v1/projekte', ['name' => 'Eingang', 'ausrichtung' => 'portrait']))['projekt']['id'];
        $this->studio('POST', "/v1/projekte/{$this->projektId}/veroeffentlichen", []);
        self::assertSame($this->projektId, self::body($this->asDevice($token, 'GET', '/v1/player/revision'))['projektId']);

        $geraetId = self::body($this->studio('GET', '/v1/geraete'))['geraete'][0]['id'];
        $this->studio('PATCH', "/v1/geraete/{$geraetId}", ['projektId' => $zweites]);
        $r = self::body($this->asDevice($token, 'GET', '/v1/player/revision'));
        self::assertSame([$zweites, null], [$r['projektId'], $r['revision']]);
    }

    public function testBlockedDeviceGetsNoManifest(): void
    {
        $token = $this->device();
        $this->studio('POST', "/v1/projekte/{$this->projektId}/veroeffentlichen", []);
        $geraetId = self::body($this->studio('GET', '/v1/geraete'))['geraete'][0]['id'];
        $this->studio('PATCH', "/v1/geraete/{$geraetId}", ['gesperrt' => true]);
        self::assertSame(403, $this->asDevice($token, 'GET', '/v1/player/manifest')->status);
        self::assertSame(403, $this->asDevice($token, 'GET', '/v1/player/revision')->status);
    }
}
