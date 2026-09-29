CREATE TABLE categories (
    id BIGINT NOT NULL AUTO_INCREMENT,
    parent_id BIGINT NULL,
    path VARCHAR(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    name VARCHAR(60) NOT NULL,
    depth INT NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uk_categories_path UNIQUE (path),
    CONSTRAINT fk_categories_parent FOREIGN KEY (parent_id) REFERENCES categories(id),
    CONSTRAINT ck_categories_depth CHECK (depth BETWEEN 1 AND 3),
    INDEX ix_categories_parent (parent_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

ALTER TABLE posts
    ADD COLUMN category_id BIGINT NULL,
    ADD INDEX ix_posts_category (category_id),
    ADD CONSTRAINT fk_posts_category FOREIGN KEY (category_id) REFERENCES categories(id);

CREATE TABLE post_tags (
    id BIGINT NOT NULL AUTO_INCREMENT,
    post_id BIGINT NOT NULL,
    position INT NOT NULL,
    tag_name VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT fk_post_tags_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    CONSTRAINT uk_post_tags_position UNIQUE (post_id, position),
    CONSTRAINT uk_post_tags_name UNIQUE (post_id, tag_name),
    INDEX ix_post_tags_name (tag_name, post_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
