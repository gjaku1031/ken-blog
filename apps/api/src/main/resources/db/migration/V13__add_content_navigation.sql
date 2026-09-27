ALTER TABLE posts
    ADD COLUMN summary VARCHAR(120) NOT NULL DEFAULT '',
    ADD COLUMN pin_order INT NULL,
    ADD COLUMN view_count BIGINT NOT NULL DEFAULT 0,
    ADD INDEX ix_posts_pin (pin_order, id),
    ADD INDEX ix_posts_feed (section, status, visibility, published_at DESC, id DESC);

ALTER TABLE editor_drafts
    ADD COLUMN summary VARCHAR(120) NOT NULL DEFAULT '',
    ADD COLUMN project_stack_names TEXT NULL;
