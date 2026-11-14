<?php
declare(strict_types=1);

namespace Plinth\Api\Tests;

use Plinth\Api\App;
use Plinth\Api\Dateien\DateienService;
use Plinth\Api\Http\Response;
use Plinth\Api\Logger;

final class UploadTest extends ApiTestCase
{
    use StorageTestTrait;

    private string $session;

    protected function setUp(): void
    {
        parent::setUp();
        $storage = self::storage();
        $this->app = new App(self::config(), new Logger(null), fn () => self::$db, fn () => $storage);
        $this->session = $this->loginAs('upload@kunde.de');
    }

    private function studio(string $method, string $path, ?array $json = null, ?string $session = null): Response
    {
        return $this->request($method, $path, $json, [], ['plinth_session' => $session ?? $this->session]);
    }

    /** Lädt $data komplett hoch; liefert die Antwort von "abschliessen". */
    private function upload(string $data, string $mime = 'video/mp4', bool $mitPruefsummen = false): Response
    {
        $start = $this->studio('POST', '/v1/uploads', ['name' => 'film.mp4', 'mime' => $mime, 'groesse' => strlen($data)]);
        self::assertSame(201, $start->status, $start->body);
        $info = self::body($start);
        $id = $info['datei']['id'];
        $size = $info['upload']['teilGroesse'];

        $teile = range(1, $info['upload']['teileAnzahl']);
        $chunks = [];
        $summen = [];
        foreach ($teile as $n) {
            $chunks[$n] = substr($data, ($n - 1) * $size, $size);
            $summen[(string) $n] = base64_encode(hash('sha256', $chunks[$n], true));
        }
        $urls = self::body($this->studio('POST', "/v1/uploads/{$id}/teile", ['teile' => $teile] + ($mitPruefsummen ? ['pruefsummen' => $summen] : [])))['urls'];

        $done = [];
        foreach ($teile as $n) {
            $headers = $mitPruefsummen ? ['x-amz-checksum-sha256' => $summen[(string) $n]] : [];
            [$status, $etag] = self::put($urls[(string) $n], $chunks[$n], $headers);
            self::assertSame(200, $status);
            $done[] = ['nummer' => $n, 'etag' => $etag];
        }
        return $this->studio('POST', "/v1/uploads/{$id}/abschliessen", ['teile' => $done, 'sha256' => hash('sha256', $data)]);
    }

    public function testPartSizing(): void
    {
        self::assertSame(8 * 1024 * 1024, DateienService::teilGroesse(100));
        self::assertSame(1, DateienService::teileAnzahl(100));
        self::assertSame(2, DateienService::teileAnzahl(9 * 1024 * 1024));
        // 200 GB → Teile werden größer, damit 10 000 nicht überschritten werden
        self::assertLessThanOrEqual(10000, DateienService::teileAnzahl(200_000_000_000));
    }

    public function testMultipartUploadAndDownload(): void
    {
        $data = random_bytes(9 * 1024 * 1024 + 123); // 2 Teile
        $res = $this->upload($data);
        self::assertSame(200, $res->status, $res->body);
        $datei = self::body($res)['datei'];
        self::assertSame('fertig', $datei['status']);
        self::assertSame(hash('sha256', $data), $datei['sha256']);
        self::assertSame('video', $datei['typ']);

        $list = self::body($this->studio('GET', '/v1/dateien'))['dateien'];
        self::assertCount(1, $list);
        [$status, $body] = self::get($list[0]['url']);
        self::assertSame(200, $status);
        self::assertSame(hash('sha256', $data), hash('sha256', $body));
    }

    public function testUploadWithPartChecksums(): void
    {
        $res = $this->upload(random_bytes(1000), 'image/png', true);
        self::assertSame(200, $res->status, $res->body);
    }

    public function testPartChecksumsCanBeDisabled(): void
    {
        $storage = self::storage();
        $config = \Plinth\Api\Config::fromArray(['S3_PART_CHECKSUMS' => 'false'] + (fn () => $this->values)->call(self::config()));
        $this->app = new App($config, new Logger(null), fn () => self::$db, fn () => $storage);
        $info = self::body($this->studio('POST', '/v1/uploads', ['name' => 'a.png', 'mime' => 'image/png', 'groesse' => 10]));
        $res = self::body($this->studio('POST', "/v1/uploads/{$info['datei']['id']}/teile", ['teile' => [1], 'pruefsummen' => ['1' => base64_encode(hash('sha256', 'x', true))]]));
        self::assertFalse($res['pruefsummen']);
        self::assertStringNotContainsStringIgnoringCase('checksum', $res['urls']['1']);
    }

    public function testResumeListsFinishedParts(): void
    {
        $data = random_bytes(9 * 1024 * 1024);
        $info = self::body($this->studio('POST', '/v1/uploads', ['name' => 'a.mp4', 'mime' => 'video/mp4', 'groesse' => strlen($data)]));
        $id = $info['datei']['id'];
        $url = self::body($this->studio('POST', "/v1/uploads/{$id}/teile", ['teile' => [1]]))['urls']['1'];
        self::put($url, substr($data, 0, $info['upload']['teilGroesse']));

        $status = self::body($this->studio('GET', "/v1/uploads/{$id}"));
        self::assertSame([1], array_column($status['upload']['fertigeTeile'], 'nummer'));
        self::assertSame(2, $status['upload']['teileAnzahl']);
    }

    public function testSizeMismatchIsRejected(): void
    {
        $info = self::body($this->studio('POST', '/v1/uploads', ['name' => 'a.jpg', 'mime' => 'image/jpeg', 'groesse' => 5000]));
        $id = $info['datei']['id'];
        $url = self::body($this->studio('POST', "/v1/uploads/{$id}/teile", ['teile' => [1]]))['urls']['1'];
        [, $etag] = self::put($url, random_bytes(4000));
        $res = $this->studio('POST', "/v1/uploads/{$id}/abschliessen", ['teile' => [['nummer' => 1, 'etag' => $etag]], 'sha256' => str_repeat('a', 64)]);
        self::assertSame(422, $res->status);
        self::assertSame('size_mismatch', self::body($res)['error']['code']);
        self::assertSame([], self::body($this->studio('GET', '/v1/dateien'))['dateien']);
    }

    public function testMissingPartsCannotComplete(): void
    {
        $info = self::body($this->studio('POST', '/v1/uploads', ['name' => 'a.mp4', 'mime' => 'video/mp4', 'groesse' => 9 * 1024 * 1024]));
        $res = $this->studio('POST', "/v1/uploads/{$info['datei']['id']}/abschliessen", ['teile' => [['nummer' => 1, 'etag' => '"x"']], 'sha256' => str_repeat('a', 64)]);
        self::assertSame(422, $res->status);
    }

    public function testValidation(): void
    {
        $res = $this->studio('POST', '/v1/uploads', ['name' => 'x.exe', 'mime' => 'application/x-msdownload', 'groesse' => 0]);
        self::assertSame(422, $res->status);
        self::assertSame(['mime', 'groesse'], array_keys(self::body($res)['error']['details']['fields']));
        $res = $this->studio('POST', '/v1/uploads', ['name' => 'x.mp4', 'mime' => 'video/mp4', 'groesse' => 21_000_000_000]);
        self::assertSame(422, $res->status);
    }

    public function testPartNumbersAreChecked(): void
    {
        $info = self::body($this->studio('POST', '/v1/uploads', ['name' => 'a.jpg', 'mime' => 'image/jpeg', 'groesse' => 100]));
        self::assertSame(422, $this->studio('POST', "/v1/uploads/{$info['datei']['id']}/teile", ['teile' => [2]])->status);
    }

    public function testAbort(): void
    {
        $info = self::body($this->studio('POST', '/v1/uploads', ['name' => 'a.jpg', 'mime' => 'image/jpeg', 'groesse' => 100]));
        $id = $info['datei']['id'];
        self::assertSame(204, $this->studio('DELETE', "/v1/uploads/{$id}")->status);
        self::assertSame(404, $this->studio('GET', "/v1/uploads/{$id}")->status);
    }

    public function testOtherCustomersCannotTouchUploadsOrFiles(): void
    {
        $info = self::body($this->studio('POST', '/v1/uploads', ['name' => 'a.jpg', 'mime' => 'image/jpeg', 'groesse' => 100]));
        $id = $info['datei']['id'];
        $fremd = $this->loginAs('fremd@anderer.de');
        self::assertSame(404, $this->studio('GET', "/v1/uploads/{$id}", null, $fremd)->status);
        self::assertSame(404, $this->studio('POST', "/v1/uploads/{$id}/teile", ['teile' => [1]], $fremd)->status);
        self::assertSame(404, $this->studio('DELETE', "/v1/uploads/{$id}", null, $fremd)->status);
        self::assertSame(404, $this->studio('PATCH', "/v1/dateien/{$id}", ['name' => 'x'], $fremd)->status);
    }

    public function testPosterAndMetadata(): void
    {
        $video = self::body($this->upload(random_bytes(500)))['datei'];
        $bild = self::body($this->upload(random_bytes(300), 'image/jpeg'))['datei'];

        $res = $this->studio('PATCH', "/v1/dateien/{$video['id']}", [
            'vorschauDateiId' => $bild['id'], 'breite' => 1920, 'hoehe' => 1080, 'dauerSekunden' => 12.5, 'name' => 'Rundgang',
        ]);
        self::assertSame(200, $res->status, $res->body);
        $d = self::body($res)['datei'];
        self::assertSame([$bild['id'], 1920, 1080, 12.5, 'Rundgang'], [$d['vorschauDateiId'], $d['breite'], $d['hoehe'], $d['dauerSekunden'], $d['name']]);

        // Ein Video kann kein Vorschaubild sein.
        self::assertSame(422, $this->studio('PATCH', "/v1/dateien/{$video['id']}", ['vorschauDateiId' => $video['id']])->status);
    }

    public function testDeleteHidesFromLibrary(): void
    {
        $datei = self::body($this->upload(random_bytes(100), 'image/png'))['datei'];
        self::assertSame(204, $this->studio('DELETE', "/v1/dateien/{$datei['id']}")->status);
        self::assertSame([], self::body($this->studio('GET', '/v1/dateien'))['dateien']);
    }
}
