CREATE TABLE home_profile (
    id BIGINT NOT NULL,
    name VARCHAR(100) NOT NULL,
    tagline VARCHAR(240) NOT NULL,
    intro TEXT NOT NULL,
    github VARCHAR(500) NOT NULL,
    email VARCHAR(254) NOT NULL,
    phone VARCHAR(40) NOT NULL,
    photo_object_key VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT ck_home_profile_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
