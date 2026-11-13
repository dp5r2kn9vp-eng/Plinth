-- Sitzungen (nur Token-Hash gespeichert) und Rate-Limiting
CREATE TABLE auth_sessions (
    id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    benutzer_id        BIGINT UNSIGNED NOT NULL,
    token_hash         CHAR(64) NOT NULL,
    erstellt_am        DATETIME NOT NULL,
    laeuft_ab_am       DATETIME NOT NULL,
    zuletzt_gesehen_am DATETIME NOT NULL,
    ip                 VARCHAR(45) NOT NULL,
    user_agent         VARCHAR(255) NOT NULL DEFAULT '',
    UNIQUE KEY uq_auth_sessions_token (token_hash),
    KEY ix_auth_sessions_benutzer (benutzer_id),
    KEY ix_auth_sessions_ablauf (laeuft_ab_am),
    CONSTRAINT fk_auth_sessions_benutzer FOREIGN KEY (benutzer_id) REFERENCES benutzer (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE rate_limits (
    bucket       CHAR(64) NOT NULL PRIMARY KEY,
    hits         INT UNSIGNED NOT NULL,
    window_start DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
