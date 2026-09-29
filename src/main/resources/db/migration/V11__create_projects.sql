CREATE TABLE projects (
    id BIGINT NOT NULL AUTO_INCREMENT,
    slug VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    start_period VARCHAR(7) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    end_period VARCHAR(7) CHARACTER SET ascii COLLATE ascii_bin NULL,
    overview VARCHAR(500) NOT NULL,
    visibility VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    home_post_id BIGINT NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uk_projects_slug UNIQUE (slug),
    CONSTRAINT uk_projects_name UNIQUE (name),
    CONSTRAINT uk_projects_home_post UNIQUE (home_post_id),
    CONSTRAINT ck_projects_status CHECK (status IN ('PLAN', 'DEV', 'MAINT', 'DONE')),
    CONSTRAINT ck_projects_visibility CHECK (visibility IN ('PUBLIC', 'PRIVATE')),
    CONSTRAINT fk_projects_home FOREIGN KEY (home_post_id) REFERENCES posts(id),
    INDEX ix_projects_created (created_at DESC, id DESC)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

ALTER TABLE posts
    ADD COLUMN section VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'TECH',
    ADD COLUMN project_id BIGINT NULL,
    ADD COLUMN related_project_id BIGINT NULL,
    ADD COLUMN document_order INT NULL,
    ADD CONSTRAINT ck_posts_section CHECK (section IN ('TECH', 'PROJECT_HOME', 'PROJECT_DOC')),
    ADD CONSTRAINT ck_posts_project_shape CHECK (
        (section = 'TECH' AND project_id IS NULL AND document_order IS NULL) OR
        (section = 'PROJECT_HOME' AND project_id IS NOT NULL AND document_order IS NULL) OR
        (section = 'PROJECT_DOC' AND project_id IS NOT NULL AND document_order IS NOT NULL)
    ),
    ADD CONSTRAINT fk_posts_project FOREIGN KEY (project_id) REFERENCES projects(id),
    ADD CONSTRAINT fk_posts_related_project FOREIGN KEY (related_project_id) REFERENCES projects(id) ON DELETE SET NULL,
    ADD INDEX ix_posts_project_order (project_id, section, document_order, id),
    ADD INDEX ix_posts_related_project (related_project_id, section, status, published_at DESC, id DESC);

ALTER TABLE editor_drafts
    ADD COLUMN section VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'TECH',
    ADD COLUMN project_id BIGINT NULL,
    ADD COLUMN related_project_id BIGINT NULL,
    ADD COLUMN document_order INT NULL,
    ADD COLUMN project_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
    ADD COLUMN project_start_period VARCHAR(7) CHARACTER SET ascii COLLATE ascii_bin NULL,
    ADD COLUMN project_end_period VARCHAR(7) CHARACTER SET ascii COLLATE ascii_bin NULL,
    ADD COLUMN project_overview VARCHAR(500) NULL,
    ADD COLUMN base_project_updated_at DATETIME(6) NULL,
    ADD CONSTRAINT ck_editor_drafts_section CHECK (section IN ('TECH', 'PROJECT_HOME', 'PROJECT_DOC')),
    ADD CONSTRAINT ck_editor_drafts_project_status CHECK (project_status IS NULL OR project_status IN ('PLAN', 'DEV', 'MAINT', 'DONE')),
    ADD INDEX ix_editor_drafts_project (project_id, section);
