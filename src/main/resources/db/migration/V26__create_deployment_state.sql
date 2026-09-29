CREATE TABLE deployment_state (
    singleton_id TINYINT NOT NULL PRIMARY KEY,
    operation_id VARCHAR(36) NULL,
    status VARCHAR(16) NOT NULL,
    run_id VARCHAR(32) NULL,
    html_url VARCHAR(512) NULL,
    error_message VARCHAR(512) NULL,
    source VARCHAR(32) NULL,
    version BIGINT NOT NULL,
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT chk_deployment_singleton CHECK (singleton_id = 1)
);
INSERT INTO deployment_state (singleton_id, status, version) VALUES (1, 'IDLE', 0);
