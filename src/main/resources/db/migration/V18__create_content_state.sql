CREATE TABLE content_state (
    id TINYINT NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT ck_content_state_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

INSERT INTO content_state (id) VALUES (1);
