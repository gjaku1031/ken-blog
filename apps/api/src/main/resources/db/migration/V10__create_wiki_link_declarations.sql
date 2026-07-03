CREATE TABLE post_wiki_links (
    id BIGINT NOT NULL AUTO_INCREMENT,
    post_id BIGINT NOT NULL,
    position INT NOT NULL,
    target_title VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT fk_post_wiki_links_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    CONSTRAINT uk_post_wiki_links_title UNIQUE (post_id, target_title),
    INDEX ix_post_wiki_links_post_order (post_id, position),
    INDEX ix_post_wiki_links_title (target_title)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE editor_draft_wiki_links (
    id BIGINT NOT NULL AUTO_INCREMENT,
    editor_draft_id BIGINT NOT NULL,
    position INT NOT NULL,
    target_title VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT fk_editor_draft_wiki_links_draft FOREIGN KEY (editor_draft_id) REFERENCES editor_drafts(id) ON DELETE CASCADE,
    CONSTRAINT uk_editor_draft_wiki_links_title UNIQUE (editor_draft_id, target_title),
    INDEX ix_editor_draft_wiki_links_draft_order (editor_draft_id, position),
    INDEX ix_editor_draft_wiki_links_title (target_title)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
