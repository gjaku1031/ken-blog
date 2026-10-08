-- 2026-10-08 2단계(축소): 새 API 배포·기동 확인 후 실행. 값이 하나로 고정되거나 코드가 읽지 않는 열 제거
-- attachments.status는 모두 READY, uploaded_by는 관리자 한 명, posts.section은 모두 TECH, visibility는 모두 PUBLIC
ALTER TABLE attachments DROP FOREIGN KEY fk_attachments_uploaded_by, DROP CHECK ck_attachments_status;
ALTER TABLE attachments DROP INDEX ix_attachments_status_created, DROP INDEX fk_attachments_uploaded_by,
    DROP COLUMN status, DROP COLUMN original_filename, DROP COLUMN uploaded_by;
ALTER TABLE posts DROP CHECK ck_posts_section, DROP CHECK ck_posts_public_only, DROP CHECK ck_posts_visibility;
ALTER TABLE posts DROP INDEX ix_posts_feed, DROP INDEX ix_posts_published_visibility,
    DROP COLUMN section, DROP COLUMN visibility;
ALTER TABLE series DROP INDEX uk_series_legacy,
    DROP COLUMN legacy_source, DROP COLUMN legacy_id, DROP COLUMN visibility;
ALTER TABLE users DROP COLUMN display_name;
