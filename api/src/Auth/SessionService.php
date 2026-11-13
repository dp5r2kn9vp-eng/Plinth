<?php
declare(strict_types=1);

namespace Plinth\Api\Auth;

use PDO;

/**
 * Sitzungen der Designer-Benutzer.
 * Das Token ist ein Zufallswert im HttpOnly-Cookie; in der Datenbank steht nur sein SHA-256-Hash.
 */
final class SessionService
{
    /** Wird geprüft, wenn es die E-Mail nicht gibt, damit die Antwortzeit nichts verrät. */
    private const DUMMY_HASH = '$argon2id$v=19$m=65536,t=4,p=1$aWtKOVFoNVFyMXgyc1BYWA$Z3FzuJ3GKRVG7xlss1LldrCAPCHiXZjFA3btDmjmTBo';

    public function __construct(
        private PDO $db,
        private int $ttlSeconds,
        private int $rememberSeconds,
    ) {
    }

    public static function hashPassword(string $password): string
    {
        return password_hash($password, PASSWORD_ARGON2ID);
    }

    /**
     * Prüft E-Mail und Passwort. Liefert den Benutzer oder null (ohne zu verraten, was falsch war).
     *
     * @return array<string,mixed>|null
     */
    public function verifyCredentials(string $email, string $password): ?array
    {
        $stmt = $this->db->prepare(
            'SELECT b.id, b.kunde_id, b.email, b.name, b.passwort_hash, b.aktiv AS benutzer_aktiv, k.aktiv AS kunde_aktiv
             FROM benutzer b JOIN kunden k ON k.id = b.kunde_id
             WHERE b.email = :email'
        );
        $stmt->execute(['email' => $email]);
        $user = $stmt->fetch();

        if ($user === false) {
            password_verify($password, self::DUMMY_HASH);
            return null;
        }
        if (!password_verify($password, $user['passwort_hash'])) {
            return null;
        }
        if (!$user['benutzer_aktiv'] || !$user['kunde_aktiv']) {
            return null;
        }

        if (password_needs_rehash($user['passwort_hash'], PASSWORD_ARGON2ID)) {
            $this->db->prepare('UPDATE benutzer SET passwort_hash = :h WHERE id = :id')
                ->execute(['h' => self::hashPassword($password), 'id' => $user['id']]);
        }
        return $user;
    }

    /**
     * Legt eine neue Sitzung an.
     *
     * @return array{token:string,expiresAt:int}
     */
    public function create(int $userId, bool $remember, string $ip, string $userAgent): array
    {
        $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $expiresAt = time() + ($remember ? $this->rememberSeconds : $this->ttlSeconds);

        $this->db->prepare(
            'INSERT INTO auth_sessions (benutzer_id, token_hash, erstellt_am, laeuft_ab_am, zuletzt_gesehen_am, ip, user_agent)
             VALUES (:uid, :hash, UTC_TIMESTAMP(), FROM_UNIXTIME(:exp), UTC_TIMESTAMP(), :ip, :ua)'
        )->execute([
            'uid' => $userId,
            'hash' => hash('sha256', $token),
            'exp' => $expiresAt,
            'ip' => substr($ip, 0, 45),
            'ua' => mb_substr($userAgent, 0, 255),
        ]);
        $this->db->prepare('UPDATE benutzer SET letzter_login_am = UTC_TIMESTAMP() WHERE id = :id')
            ->execute(['id' => $userId]);

        // Abgelaufene Sitzungen nebenbei aufräumen.
        $this->db->exec('DELETE FROM auth_sessions WHERE laeuft_ab_am < UTC_TIMESTAMP() LIMIT 100');

        return ['token' => $token, 'expiresAt' => $expiresAt];
    }

    /**
     * Liefert den Benutzer zur gültigen Sitzung oder null.
     *
     * @return array{id:int,kundeId:int,email:string,name:string}|null
     */
    public function userForToken(string $token): ?array
    {
        $stmt = $this->db->prepare(
            'SELECT s.id AS session_id, s.zuletzt_gesehen_am, b.id, b.kunde_id, b.email, b.name
             FROM auth_sessions s
             JOIN benutzer b ON b.id = s.benutzer_id
             JOIN kunden k ON k.id = b.kunde_id
             WHERE s.token_hash = :hash AND s.laeuft_ab_am > UTC_TIMESTAMP() AND b.aktiv = 1 AND k.aktiv = 1'
        );
        $stmt->execute(['hash' => hash('sha256', $token)]);
        $row = $stmt->fetch();
        if ($row === false) {
            return null;
        }

        // "Zuletzt gesehen" höchstens alle 5 Minuten schreiben.
        $this->db->prepare(
            'UPDATE auth_sessions SET zuletzt_gesehen_am = UTC_TIMESTAMP()
             WHERE id = :id AND zuletzt_gesehen_am < UTC_TIMESTAMP() - INTERVAL 5 MINUTE'
        )->execute(['id' => $row['session_id']]);

        return [
            'id' => (int) $row['id'],
            'kundeId' => (int) $row['kunde_id'],
            'email' => (string) $row['email'],
            'name' => (string) $row['name'],
        ];
    }

    public function destroy(string $token): void
    {
        $this->db->prepare('DELETE FROM auth_sessions WHERE token_hash = :hash')
            ->execute(['hash' => hash('sha256', $token)]);
    }
}
