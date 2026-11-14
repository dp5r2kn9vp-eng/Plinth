<?php
declare(strict_types=1);

namespace Plinth\Api\Setup;

use PDO;
use Plinth\Api\Auth\SessionService;
use Plinth\Api\Kunden\KundenService;

/** Legt den allerersten Kunden und Benutzer an – nur solange es noch keinen Benutzer gibt. */
final class FirstUser
{
    public function __construct(private PDO $db)
    {
    }

    public function allowed(): bool
    {
        return (int) $this->db->query('SELECT COUNT(*) FROM benutzer')->fetchColumn() === 0;
    }

    /**
     * @return array{errors: array<string,string>, kundencode?: string}
     */
    public function create(string $kunde, string $name, string $email, string $password, string $password2): array
    {
        $email = mb_strtolower(trim($email));
        $errors = [];
        if (trim($kunde) === '' || mb_strlen($kunde) > 190) {
            $errors['kunde'] = 'Kundenname fehlt.';
        }
        if (trim($name) === '' || mb_strlen($name) > 190) {
            $errors['name'] = 'Name fehlt.';
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $errors['email'] = 'Ungültige E-Mail.';
        }
        if (strlen($password) < 10) {
            $errors['password'] = 'Passwort muss mindestens 10 Zeichen haben.';
        } elseif ($password !== $password2) {
            $errors['password2'] = 'Passwörter stimmen nicht überein.';
        }
        if ($errors !== []) {
            return ['errors' => $errors];
        }

        $this->db->beginTransaction();
        try {
            // Sperre gegen doppeltes Absenden
            if ((int) $this->db->query('SELECT COUNT(*) FROM benutzer FOR UPDATE')->fetchColumn() > 0) {
                $this->db->rollBack();
                return ['errors' => ['form' => 'Es gibt bereits einen Benutzer.']];
            }
            $code = KundenService::generateCode();
            $this->db->prepare('INSERT INTO kunden (name, kundencode) VALUES (?, ?)')->execute([trim($kunde), $code]);
            $kundeId = (int) $this->db->lastInsertId();
            $this->db->prepare('INSERT INTO benutzer (kunde_id, email, name, passwort_hash) VALUES (?, ?, ?, ?)')
                ->execute([$kundeId, $email, trim($name), SessionService::hashPassword($password)]);
            $this->db->prepare('INSERT INTO projekte (kunde_id, name, ausrichtung) VALUES (?, ?, ?)')
                ->execute([$kundeId, 'Hauptbildschirm', 'landscape']);
            $this->db->commit();
        } catch (\Throwable $e) {
            $this->db->rollBack();
            throw $e;
        }
        return ['errors' => [], 'kundencode' => KundenService::formatCode($code)];
    }
}
