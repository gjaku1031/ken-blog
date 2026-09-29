CREATE TABLE courses (
    id BIGINT NOT NULL AUTO_INCREMENT,
    slug VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    field VARCHAR(100) NOT NULL,
    name VARCHAR(200) NOT NULL,
    description VARCHAR(500) NOT NULL,
    status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uk_courses_slug UNIQUE (slug),
    CONSTRAINT ck_courses_status CHECK (status IN ('IN_PROGRESS', 'COMPLETED')),
    INDEX ix_courses_created (created_at, id)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

ALTER TABLE posts
    ADD COLUMN course_id BIGINT NULL,
    ADD COLUMN chapter_order INT NULL,
    DROP CHECK ck_posts_section,
    DROP CHECK ck_posts_project_shape,
    ADD CONSTRAINT ck_posts_section CHECK (section IN ('TECH', 'PROJECT_HOME', 'PROJECT_DOC', 'NOTE_CHAPTER')),
    ADD CONSTRAINT ck_posts_owner_shape CHECK (
        (section = 'TECH' AND project_id IS NULL AND document_order IS NULL AND course_id IS NULL AND chapter_order IS NULL) OR
        (section = 'PROJECT_HOME' AND project_id IS NOT NULL AND document_order IS NULL AND course_id IS NULL AND chapter_order IS NULL) OR
        (section = 'PROJECT_DOC' AND project_id IS NOT NULL AND document_order IS NOT NULL AND course_id IS NULL AND chapter_order IS NULL) OR
        (section = 'NOTE_CHAPTER' AND project_id IS NULL AND document_order IS NULL AND course_id IS NOT NULL AND chapter_order IS NOT NULL)
    ),
    ADD CONSTRAINT fk_posts_course FOREIGN KEY (course_id) REFERENCES courses(id),
    ADD INDEX ix_posts_course_order (course_id, section, chapter_order, id);

ALTER TABLE editor_drafts
    ADD COLUMN course_id BIGINT NULL,
    ADD COLUMN chapter_order INT NULL,
    DROP CHECK ck_editor_drafts_section,
    ADD CONSTRAINT ck_editor_drafts_section CHECK (section IN ('TECH', 'PROJECT_HOME', 'PROJECT_DOC', 'NOTE_CHAPTER')),
    ADD INDEX ix_editor_drafts_course (course_id, section);
