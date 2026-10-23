-- 2026-10-23 1단계(확장): 옛 API(DRAFT·PUBLISHED) 배포 전 실행. 2026-10-13의 미검수·비공개 상태 철회
-- 실행 전 확인: 공개가 아닌 글과 DB 본문이 모두 0건이어야 함. 옛 API는 그 밖의 상태를 읽지 못하고 DB 본문을 내보내지 않음
--   SELECT COUNT(*) FROM posts WHERE status NOT IN ('DRAFT', 'PUBLISHED');
--   SELECT COUNT(*) FROM post_bodies;
-- 상태 CHECK는 10-13 확장 SQL이 'DRAFT'를 남겨 두었으므로 그대로 두고, 기본값만 옛 API의 초안으로 되돌림
ALTER TABLE posts ALTER COLUMN status SET DEFAULT 'DRAFT';
