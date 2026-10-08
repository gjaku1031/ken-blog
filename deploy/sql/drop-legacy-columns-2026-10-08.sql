-- 2026-10-08 2단계(축소): 새 API 배포·기동 확인 후 실행. 사용자 결정으로 백업 없이 삭제.
-- 옛 본문이 남은 글 7개는 모두 Git 원고(content/posts)가 있음.
ALTER TABLE posts DROP INDEX ix_posts_pin;
ALTER TABLE posts DROP COLUMN body, DROP COLUMN body_sha256, DROP COLUMN pin_order, DROP COLUMN view_count;
ALTER TABLE attachments DROP COLUMN pending_cleanup;
ALTER TABLE admin_auth_state DROP COLUMN last_totp_step;
