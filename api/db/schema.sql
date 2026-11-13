-- Plinth Datenbankschema (MySQL/MariaDB), Version 1
SET NAMES utf8mb4;

CREATE TABLE customers (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(190) NOT NULL,
  device_code   CHAR(12)     NOT NULL UNIQUE COMMENT 'Kundencode, den der Player einmalig eingibt',
  maintenance_pin_hash VARCHAR(255) NULL COMMENT 'PIN für den Wartungsmodus (password_hash)',
  active        TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id   INT UNSIGNED NULL COMMENT 'NULL = Betreiber (Superadmin)',
  email         VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('operator','admin','editor') NOT NULL DEFAULT 'editor',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE auth_tokens (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE COMMENT 'SHA-256 des Tokens',
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE login_attempts (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ip         VARCHAR(45)  NOT NULL,
  email      VARCHAR(190) NULL,
  success    TINYINT(1)   NOT NULL DEFAULT 0,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ip_time (ip, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE projects (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id INT UNSIGNED NOT NULL,
  name        VARCHAR(190) NOT NULL,
  width       SMALLINT UNSIGNED NOT NULL DEFAULT 1920,
  height      SMALLINT UNSIGNED NOT NULL DEFAULT 1080,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE drafts (
  project_id  INT UNSIGNED PRIMARY KEY,
  layout_json JSON NOT NULL,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by  INT UNSIGNED NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE assets (
  id            VARCHAR(64) NOT NULL PRIMARY KEY COMMENT 'assetId in Layout und Manifest',
  customer_id   INT UNSIGNED NOT NULL,
  kind          ENUM('video','image') NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  storage_key   VARCHAR(500) NOT NULL COMMENT 'Pfad im Objektspeicher',
  size          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  sha256        CHAR(64) NULL,
  mime          VARCHAR(100) NULL,
  width         SMALLINT UNSIGNED NULL,
  height        SMALLINT UNSIGNED NULL,
  duration_s    DECIMAL(10,2) NULL,
  status        ENUM('uploading','ready','failed') NOT NULL DEFAULT 'uploading',
  upload_id     VARCHAR(255) NULL COMMENT 'Multipart-Upload-ID',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_customer (customer_id),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE revisions (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id    INT UNSIGNED NOT NULL,
  revision_no   INT UNSIGNED NOT NULL,
  manifest_json JSON NOT NULL COMMENT 'unveränderlich nach Veröffentlichung',
  is_default    TINYINT(1) NOT NULL DEFAULT 1,
  valid_from    DATETIME NULL,
  valid_to      DATETIME NULL,
  priority      INT NOT NULL DEFAULT 0,
  published_by  INT UNSIGNED NULL,
  published_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_project_rev (project_id, revision_no),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE devices (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id       INT UNSIGNED NOT NULL,
  project_id        INT UNSIGNED NULL COMMENT 'welches Projekt dieses Gerät abspielt',
  name              VARCHAR(190) NOT NULL,
  token_hash        CHAR(64) NOT NULL UNIQUE COMMENT 'SHA-256 des Gerätetokens',
  current_revision  INT UNSIGNED NULL,
  last_seen_at      DATETIME NULL,
  player_version    VARCHAR(40) NULL,
  revoked_at        DATETIME NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id)  REFERENCES projects(id)  ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
