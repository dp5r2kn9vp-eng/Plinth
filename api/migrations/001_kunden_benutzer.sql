-- Kunden und Designer-Benutzer (Ticket: Auth für Designer-Benutzer)
CREATE TABLE kunden (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(190) NOT NULL,
    aktiv       TINYINT(1) NOT NULL DEFAULT 1,
    erstellt_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE benutzer (
    id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    kunde_id         BIGINT UNSIGNED NOT NULL,
    email            VARCHAR(190) NOT NULL,
    name             VARCHAR(190) NOT NULL,
    passwort_hash    VARCHAR(255) NOT NULL,
    aktiv            TINYINT(1) NOT NULL DEFAULT 1,
    letzter_login_am DATETIME NULL,
    erstellt_am      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_benutzer_email (email),
    KEY ix_benutzer_kunde (kunde_id),
    CONSTRAINT fk_benutzer_kunde FOREIGN KEY (kunde_id) REFERENCES kunden (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
