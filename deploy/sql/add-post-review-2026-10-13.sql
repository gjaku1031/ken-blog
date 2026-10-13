-- 2026-10-13 1단계(확장): 새 API 배포 전 실행. 공개 범위 3종·검수 표시·DB 본문·글 연결을 위한 구조 추가
-- 옛 API가 실행 중인 동안에도 INSERT가 실패하지 않도록 상태 CHECK에 'DRAFT'를 남겨 둠
-- 옛 출간일 CHECK는 'DRAFT'가 아니면 published_at을 요구해 공개한 적 없는 비공개·미검수 글을 막으므로 조건을 공개 글로 좁힘
ALTER TABLE posts DROP CHECK ck_posts_status, DROP CHECK ck_posts_published_at;
ALTER TABLE posts
    ADD COLUMN reviewed_at DATETIME(6) NULL AFTER published_at,
    ALTER COLUMN status SET DEFAULT 'UNREVIEWED',
    ADD CONSTRAINT ck_posts_status CHECK (status IN ('DRAFT', 'UNREVIEWED', 'PRIVATE', 'PUBLISHED')),
    ADD CONSTRAINT ck_posts_published_at CHECK (status <> 'PUBLISHED' OR published_at IS NOT NULL),
    ADD CONSTRAINT ck_posts_reviewed_at CHECK (reviewed_at IS NULL OR status = 'UNREVIEWED');

-- 공개하지 않은 글의 Markdown 본문. 공개 글의 본문은 저장소 원고에만 두므로 공개 전환 때 행을 지움
CREATE TABLE post_bodies (
    post_id BIGINT NOT NULL,
    body MEDIUMTEXT NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (post_id),
    CONSTRAINT fk_post_bodies_post FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 관리자에게만 보이는 글 사이의 연결. 방향 없이 양쪽에서 조회하므로 반대쪽 열에도 인덱스를 둠
-- MySQL은 FK 참조 동작이 있는 열에 CHECK를 허용하지 않아 자기 연결 금지는 운영 절차에서 지킴
CREATE TABLE post_links (
    post_id BIGINT NOT NULL,
    linked_post_id BIGINT NOT NULL,
    PRIMARY KEY (post_id, linked_post_id),
    KEY ix_post_links_linked (linked_post_id),
    CONSTRAINT fk_post_links_post FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE,
    CONSTRAINT fk_post_links_linked FOREIGN KEY (linked_post_id) REFERENCES posts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
