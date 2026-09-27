CREATE TABLE stack_badges (
    id BIGINT NOT NULL AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    name_key VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    object_key VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uk_stack_badges_name_key UNIQUE (name_key),
    CONSTRAINT uk_stack_badges_object_key UNIQUE (object_key)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE project_stack_badges (
    project_id BIGINT NOT NULL,
    badge_id BIGINT NOT NULL,
    sort_order INT NOT NULL,
    PRIMARY KEY (project_id, badge_id),
    CONSTRAINT uk_project_stack_badges_order UNIQUE (project_id, sort_order),
    CONSTRAINT fk_project_stack_badges_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_project_stack_badges_badge FOREIGN KEY (badge_id) REFERENCES stack_badges(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
