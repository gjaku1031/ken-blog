-- 2026-10-13 2단계(축소): 새 API 배포·기동 확인 후 실행. 옛 API가 쓰던 'DRAFT'를 허용 값에서 제거
-- 전환 구간에 옛 API가 만든 글이 있으면 미검수로 옮긴 뒤 조임. 새 API는 'DRAFT' 행을 읽지 못함
UPDATE posts SET status = 'UNREVIEWED' WHERE status = 'DRAFT';
ALTER TABLE posts DROP CHECK ck_posts_status;
ALTER TABLE posts ADD CONSTRAINT ck_posts_status CHECK (status IN ('UNREVIEWED', 'PRIVATE', 'PUBLISHED'));
