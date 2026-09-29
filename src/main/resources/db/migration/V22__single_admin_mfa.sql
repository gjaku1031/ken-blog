DROP TABLE member_invitations;

CREATE TABLE admin_auth_state (
    id TINYINT NOT NULL,
    config_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    auth_version BIGINT NOT NULL,
    last_totp_step BIGINT NULL,
    failure_count INT NOT NULL,
    locked_until DATETIME(6) NULL,
    PRIMARY KEY (id),
    CONSTRAINT ck_admin_auth_state_id CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO admin_auth_state (id, config_fingerprint, auth_version, last_totp_step, failure_count)
VALUES (1, REPEAT('0', 64), 0, NULL, 0);

CREATE TABLE admin_recovery_codes (
    code_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    consumed_at DATETIME(6) NULL,
    PRIMARY KEY (code_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
