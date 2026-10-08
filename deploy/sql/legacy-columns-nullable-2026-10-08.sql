-- 2026-10-08 1단계(확장): 새 API 배포 전에 실행. 옛 본문 열을 NULL 허용으로 바꿔
-- 본문 열을 모르는 새 API의 글 등록이 실패하지 않게 함. 기존 API도 그대로 동작함.
ALTER TABLE posts MODIFY body LONGTEXT NULL, MODIFY body_sha256 CHAR(64) NULL;
