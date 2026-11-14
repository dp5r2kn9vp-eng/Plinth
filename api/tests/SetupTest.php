<?php
declare(strict_types=1);

namespace Plinth\Api\Tests;

use Plinth\Api\Setup\FirstUser;

final class SetupTest extends ApiTestCase
{
    public function testFirstUserOnlyOnceAndCanLogIn(): void
    {
        $setup = new FirstUser(self::$db);
        self::assertTrue($setup->allowed());

        $bad = $setup->create('Firma', 'Name', 'keine-mail', 'kurz', 'kurz');
        self::assertSame(['email', 'password'], array_keys($bad['errors']));
        self::assertSame(['password2'], array_keys($setup->create('Firma', 'Name', 'a@b.de', 'langes-passwort', 'anderes-passwort')['errors']));

        $ok = $setup->create('Firma', 'Anna', ' Anna@Firma.de ', 'langes-passwort', 'langes-passwort');
        self::assertSame([], $ok['errors']);
        self::assertMatchesRegularExpression('/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/', $ok['kundencode']);
        self::assertFalse($setup->allowed());
        self::assertSame('form', array_key_first($setup->create('X', 'Y', 'x@y.de', 'langes-passwort', 'langes-passwort')['errors']));

        $res = $this->request('POST', '/v1/auth/login', ['email' => 'anna@firma.de', 'password' => 'langes-passwort']);
        self::assertSame(200, $res->status);
        self::assertSame(1, (int) self::$db->query('SELECT COUNT(*) FROM projekte')->fetchColumn(), 'Start-Projekt angelegt');
    }
}
