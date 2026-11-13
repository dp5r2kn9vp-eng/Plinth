<?php
declare(strict_types=1);

namespace Plinth\Api\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Plinth\Api\Schema\SchemaValidator;

final class SchemaTest extends TestCase
{
    private const EXAMPLES = __DIR__ . '/../../shared/examples/';

    /** @return array<string,mixed> */
    private static function load(string $file): array
    {
        return json_decode((string) file_get_contents(self::EXAMPLES . $file), true, 64, JSON_THROW_ON_ERROR);
    }

    /** @return iterable<string,array{string}> */
    public static function layoutExamples(): iterable
    {
        yield 'quer' => ['layout.example.json'];
        yield 'hochkant' => ['layout-hochkant.example.json'];
    }

    #[DataProvider('layoutExamples')]
    public function testLayoutExamplesAreValid(string $file): void
    {
        self::assertSame([], (new SchemaValidator())->validateLayout(self::load($file)));
    }

    public function testManifestExampleIsValid(): void
    {
        self::assertSame([], (new SchemaValidator())->validateManifest(self::load('manifest.example.json')));
    }

    public function testUnknownElementTypeIsRejected(): void
    {
        $layout = self::load('layout.example.json');
        $layout['pages'][0]['elements'][] = ['id' => 'x', 'type' => 'iframe', 'x' => 0, 'y' => 0, 'w' => 1, 'h' => 1];
        self::assertNotSame([], (new SchemaValidator())->validateLayout($layout));
    }

    public function testUnknownPropertyIsRejected(): void
    {
        $layout = self::load('layout.example.json');
        $layout['pages'][0]['elements'][0]['onclick'] = 'alert(1)';
        self::assertNotSame([], (new SchemaValidator())->validateLayout($layout));
    }

    public function testBadColorIsRejected(): void
    {
        $layout = self::load('layout.example.json');
        $layout['pages'][0]['elements'][0]['style']['color'] = 'red; background:url(x)';
        self::assertNotSame([], (new SchemaValidator())->validateLayout($layout));
    }

    public function testDuplicateElementIds(): void
    {
        $layout = self::load('layout.example.json');
        $layout['pages'][0]['elements'][1]['id'] = 'titel';
        self::assertStringContainsString('doppelte Element-IDs', implode("\n", (new SchemaValidator())->validateLayout($layout)));
    }

    public function testOpenPageTargetMustExist(): void
    {
        $layout = self::load('layout-hochkant.example.json');
        $layout['pages'][0]['elements'][2]['action']['page'] = 'gibtsnicht';
        self::assertStringContainsString('gibtsnicht', implode("\n", (new SchemaValidator())->validateLayout($layout)));
    }

    public function testFormatMustMatchOrientation(): void
    {
        $layout = self::load('layout.example.json');
        $layout['format']['orientation'] = 'portrait';
        self::assertStringContainsString('1080x1920', implode("\n", (new SchemaValidator())->validateLayout($layout)));
    }

    public function testManifestReferencesMustExist(): void
    {
        $manifest = self::load('manifest.example.json');
        array_pop($manifest['files']);
        self::assertStringContainsString('"f22" fehlt', implode("\n", (new SchemaValidator())->validateManifest($manifest)));
    }

    public function testManifestPathMustBeContentAddressed(): void
    {
        $manifest = self::load('manifest.example.json');
        $manifest['files'][0]['path'] = '../../windows/system32/x.jpg';
        self::assertNotSame([], (new SchemaValidator())->validateManifest($manifest));
    }

    public function testReferencedAssets(): void
    {
        $refs = SchemaValidator::referencedAssets(self::load('layout.example.json'));
        sort($refs);
        self::assertSame(['f12', 'f13', 'f20', 'f21', 'f22'], $refs);
    }
}
