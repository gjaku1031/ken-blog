CREATE TABLE post_attachments (
    post_id BIGINT NOT NULL,
    attachment_id BIGINT NOT NULL,
    PRIMARY KEY (post_id, attachment_id),
    CONSTRAINT fk_post_attachments_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    CONSTRAINT fk_post_attachments_attachment FOREIGN KEY (attachment_id) REFERENCES attachments(id) ON DELETE RESTRICT,
    INDEX ix_post_attachments_attachment (attachment_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE editor_draft_attachments (
    editor_draft_id BIGINT NOT NULL,
    attachment_id BIGINT NOT NULL,
    PRIMARY KEY (editor_draft_id, attachment_id),
    CONSTRAINT fk_editor_draft_attachments_draft FOREIGN KEY (editor_draft_id) REFERENCES editor_drafts(id) ON DELETE CASCADE,
    CONSTRAINT fk_editor_draft_attachments_attachment FOREIGN KEY (attachment_id) REFERENCES attachments(id) ON DELETE RESTRICT,
    INDEX ix_editor_draft_attachments_attachment (attachment_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
