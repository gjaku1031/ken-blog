CREATE TABLE attachments (
    id BIGINT NOT NULL AUTO_INCREMENT,
    object_key VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    content_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    byte_size BIGINT NOT NULL,
    uploaded_by BIGINT NOT NULL,
    status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    pending_cleanup BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uk_attachments_object_key UNIQUE (object_key),
    CONSTRAINT fk_attachments_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES users(id),
    CONSTRAINT ck_attachments_byte_size CHECK (byte_size > 0 AND byte_size <= 10485760),
    CONSTRAINT ck_attachments_status CHECK (status IN ('PENDING', 'READY', 'DELETING')),
    INDEX ix_attachments_status_created (status, created_at)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
