-- jOOQ 조회 타입 생성용 스키마. 운영 DDL은 JPA, 기존 자료 이행은 별도 ops 도구.
-- 조회에 사용하는 열만 정의하며 이 파일을 실제 DB에 초기화하지 않는다.
CREATE TABLE series (
    id BIGINT NOT NULL PRIMARY KEY,
    slug VARCHAR(160) NOT NULL,
    name VARCHAR(200) NOT NULL,
    description VARCHAR(1000) NOT NULL,
    kind VARCHAR(16) NOT NULL,
    visibility VARCHAR(16) NOT NULL,
    project_status VARCHAR(16),
    start_period VARCHAR(7),
    end_period VARCHAR(7),
    sort_order BIGINT NOT NULL,
    created_at TIMESTAMP(6) NOT NULL,
    updated_at TIMESTAMP(6) NOT NULL,
    legacy_source VARCHAR(16),
    legacy_id BIGINT
);
CREATE TABLE posts (
    id BIGINT NOT NULL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    slug VARCHAR(160) NOT NULL,
    summary VARCHAR(120) NOT NULL,
    status VARCHAR(16) NOT NULL,
    visibility VARCHAR(16) NOT NULL,
    created_at TIMESTAMP(6) NOT NULL,
    updated_at TIMESTAMP(6) NOT NULL,
    published_at TIMESTAMP(6),
    category_id BIGINT,
    series_id BIGINT,
    related_series_id BIGINT,
    series_order INTEGER,
    section VARCHAR(16) NOT NULL,
    legacy_path VARCHAR(500)
);
CREATE TABLE categories (
    id BIGINT NOT NULL PRIMARY KEY,
    path VARCHAR(500) NOT NULL,
    name VARCHAR(60) NOT NULL,
    sort_order INTEGER NOT NULL,
    depth INTEGER NOT NULL
);
CREATE TABLE post_tags (
    id BIGINT NOT NULL PRIMARY KEY,
    post_id BIGINT NOT NULL,
    position INTEGER NOT NULL,
    tag_name VARCHAR(100) NOT NULL,
    display_name VARCHAR(100) NOT NULL
);
CREATE TABLE post_wiki_links (
    id BIGINT NOT NULL PRIMARY KEY,
    post_id BIGINT NOT NULL,
    position INTEGER NOT NULL,
    target_title VARCHAR(200) NOT NULL
);
CREATE TABLE post_attachments (
    post_id BIGINT NOT NULL,
    attachment_id BIGINT NOT NULL
);
CREATE TABLE attachments (
    id BIGINT NOT NULL PRIMARY KEY,
    object_key VARCHAR(1024) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    byte_size BIGINT NOT NULL,
    status VARCHAR(16) NOT NULL,
    updated_at TIMESTAMP(6) NOT NULL
);
CREATE TABLE series_stack_badges (
    series_id BIGINT NOT NULL,
    badge_id BIGINT NOT NULL,
    sort_order INTEGER NOT NULL,
    PRIMARY KEY (series_id, badge_id)
);
