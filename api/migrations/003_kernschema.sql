-- Kernschema: Projekte, Entwürfe, Dateien, Revisionen, Zeitpläne, Geräte (Ticket #4, #7)

ALTER TABLE kunden ADD COLUMN kundencode CHAR(12) NULL AFTER name,
                   ADD UNIQUE KEY uq_kunden_kundencode (kundencode);

CREATE TABLE projekte (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    kunde_id        BIGINT UNSIGNED NOT NULL,
    name            VARCHAR(190) NOT NULL,
    ausrichtung     ENUM('landscape','portrait') NOT NULL DEFAULT 'landscape',
    erstellt_am     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY ix_projekte_kunde (kunde_id),
    CONSTRAINT fk_projekte_kunde FOREIGN KEY (kunde_id) REFERENCES kunden (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Genau ein Entwurf pro Projekt; version für Schutz vor gleichzeitigem Überschreiben
CREATE TABLE entwuerfe (
    projekt_id        BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    layout            LONGTEXT NOT NULL,
    version           INT UNSIGNED NOT NULL DEFAULT 1,
    aktualisiert_am   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    aktualisiert_von  BIGINT UNSIGNED NULL,
    CONSTRAINT fk_entwuerfe_projekt FOREIGN KEY (projekt_id) REFERENCES projekte (id) ON DELETE CASCADE,
    CONSTRAINT fk_entwuerfe_benutzer FOREIGN KEY (aktualisiert_von) REFERENCES benutzer (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Medien eines Kunden. Inhalt liegt im Speicher unter speicher_schluessel.
CREATE TABLE dateien (
    id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    kunde_id           BIGINT UNSIGNED NOT NULL,
    name               VARCHAR(255) NOT NULL,
    mime               VARCHAR(100) NOT NULL,
    groesse            BIGINT UNSIGNED NOT NULL,
    sha256             CHAR(64) NULL,
    speicher_schluessel VARCHAR(255) NOT NULL,
    status             ENUM('upload','fertig','fehler') NOT NULL DEFAULT 'upload',
    upload_id          VARCHAR(255) NULL,
    vorschau_datei_id  BIGINT UNSIGNED NULL,
    breite             INT UNSIGNED NULL,
    hoehe              INT UNSIGNED NULL,
    dauer_sekunden     DECIMAL(10,3) NULL,
    erstellt_am        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    erstellt_von       BIGINT UNSIGNED NULL,
    geloescht_am       DATETIME NULL,
    UNIQUE KEY uq_dateien_schluessel (speicher_schluessel),
    KEY ix_dateien_kunde (kunde_id, status),
    CONSTRAINT fk_dateien_kunde FOREIGN KEY (kunde_id) REFERENCES kunden (id) ON DELETE CASCADE,
    CONSTRAINT fk_dateien_vorschau FOREIGN KEY (vorschau_datei_id) REFERENCES dateien (id) ON DELETE SET NULL,
    CONSTRAINT fk_dateien_benutzer FOREIGN KEY (erstellt_von) REFERENCES benutzer (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Veröffentlichte Stände. Das Manifest wird nach dem Anlegen nie mehr geändert.
CREATE TABLE revisionen (
    id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    projekt_id           BIGINT UNSIGNED NOT NULL,
    nummer               INT UNSIGNED NOT NULL,
    manifest             LONGTEXT NOT NULL,
    status               ENUM('vorbereitet','aktiv','fehlgeschlagen') NOT NULL DEFAULT 'vorbereitet',
    veroeffentlicht_am   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    veroeffentlicht_von  BIGINT UNSIGNED NULL,
    UNIQUE KEY uq_revisionen_nummer (projekt_id, nummer),
    KEY ix_revisionen_status (projekt_id, status),
    CONSTRAINT fk_revisionen_projekt FOREIGN KEY (projekt_id) REFERENCES projekte (id) ON DELETE CASCADE,
    CONSTRAINT fk_revisionen_benutzer FOREIGN KEY (veroeffentlicht_von) REFERENCES benutzer (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Zeitfenster für Revisionen (Nutzung ab M2, Ticket #31)
CREATE TABLE zeitplaene (
    id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    projekt_id   BIGINT UNSIGNED NOT NULL,
    revision_id  BIGINT UNSIGNED NOT NULL,
    gueltig_ab   DATETIME NULL,
    gueltig_bis  DATETIME NULL,
    prioritaet   INT NOT NULL DEFAULT 0,
    KEY ix_zeitplaene_projekt (projekt_id),
    CONSTRAINT fk_zeitplaene_projekt FOREIGN KEY (projekt_id) REFERENCES projekte (id) ON DELETE CASCADE,
    CONSTRAINT fk_zeitplaene_revision FOREIGN KEY (revision_id) REFERENCES revisionen (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Player-Geräte. Token nur als SHA-256-Hash.
CREATE TABLE geraete (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    kunde_id            BIGINT UNSIGNED NOT NULL,
    projekt_id          BIGINT UNSIGNED NULL,
    name                VARCHAR(190) NOT NULL,
    token_hash          CHAR(64) NOT NULL,
    gesperrt            TINYINT(1) NOT NULL DEFAULT 0,
    registriert_am      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    zuletzt_gesehen_am  DATETIME NULL,
    geladene_revision   INT UNSIGNED NULL,
    app_version         VARCHAR(40) NULL,
    ip                  VARCHAR(45) NULL,
    UNIQUE KEY uq_geraete_token (token_hash),
    KEY ix_geraete_kunde (kunde_id),
    CONSTRAINT fk_geraete_kunde FOREIGN KEY (kunde_id) REFERENCES kunden (id) ON DELETE CASCADE,
    CONSTRAINT fk_geraete_projekt FOREIGN KEY (projekt_id) REFERENCES projekte (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
