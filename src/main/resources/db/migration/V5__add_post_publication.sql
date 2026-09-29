ALTER TABLE posts
    ADD COLUMN status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
    ADD COLUMN visibility VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PRIVATE',
    ADD COLUMN published_at DATETIME(6) NULL,
    ADD CONSTRAINT ck_posts_status CHECK (status IN ('DRAFT', 'PUBLISHED')),
    ADD CONSTRAINT ck_posts_visibility CHECK (visibility IN ('PUBLIC', 'PRIVATE')),
    ADD CONSTRAINT ck_posts_published_at CHECK (status = 'DRAFT' OR published_at IS NOT NULL),
    ADD INDEX ix_posts_published_visibility (status, visibility, published_at DESC, id DESC),
    ADD INDEX ix_posts_published (status, published_at DESC, id DESC);
