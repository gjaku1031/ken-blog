ALTER TABLE posts
    ADD COLUMN tech_series_order INT NULL,
    ADD INDEX ix_posts_tech_series (section, category_id, status, visibility, tech_series_order, published_at, id),
    ADD CONSTRAINT ck_posts_tech_series_order CHECK (tech_series_order IS NULL OR tech_series_order > 0);

ALTER TABLE editor_drafts
    ADD COLUMN tech_series_order INT NULL,
    ADD CONSTRAINT ck_editor_drafts_tech_series_order CHECK (tech_series_order IS NULL OR tech_series_order > 0);

ALTER TABLE post_tags
    ADD COLUMN display_name VARCHAR(40) NOT NULL DEFAULT '';

UPDATE post_tags SET display_name = tag_name;
