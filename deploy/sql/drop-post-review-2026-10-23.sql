-- 2026-10-23 2단계(축소): 옛 API 배포·기동 확인 후 실행. 10-13 확장 SQL이 추가한 구조를 지우고 CHECK를 원래대로
-- 실행 전 확인: 모든 글이 'DRAFT' 또는 'PUBLISHED'이고 post_bodies가 비어 있으며, 공개 글마다 content/posts/{slug}.md가 있음
DROP TABLE post_links;
DROP TABLE post_bodies;
ALTER TABLE posts DROP CHECK ck_posts_reviewed_at, DROP CHECK ck_posts_status, DROP CHECK ck_posts_published_at;
ALTER TABLE posts
    DROP COLUMN reviewed_at,
    ADD CONSTRAINT ck_posts_status CHECK (status IN ('DRAFT', 'PUBLISHED')),
    ADD CONSTRAINT ck_posts_published_at CHECK (status = 'DRAFT' OR published_at IS NOT NULL);
