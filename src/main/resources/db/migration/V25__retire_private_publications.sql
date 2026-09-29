-- 보존 중인 비공개 출간 원고와 비공개 프로젝트 부모를 초안으로 철회.
-- 최초 출간 시각, 본문, 주소, ID, 첨부 연결은 그대로 둔다.
UPDATE posts p
LEFT JOIN projects project ON project.id = p.project_id
LEFT JOIN posts home ON home.id = project.home_post_id
SET p.status = 'DRAFT'
WHERE p.status = 'PUBLISHED'
  AND (p.visibility = 'PRIVATE'
       OR (p.section IN ('PROJECT_HOME', 'PROJECT_DOC')
           AND (project.visibility = 'PRIVATE' OR home.visibility = 'PRIVATE')));

-- 공개 범위 기능을 제거한 런타임의 단일 PUBLIC 값으로 정규화.
-- 위 UPDATE 뒤에만 실행하므로 비공개 출간 원고가 공개 출간으로 바뀌지 않는다.
UPDATE posts SET visibility = 'PUBLIC' WHERE visibility = 'PRIVATE';
UPDATE projects SET visibility = 'PUBLIC' WHERE visibility = 'PRIVATE';
UPDATE editor_drafts SET visibility = 'PUBLIC' WHERE visibility = 'PRIVATE';

-- 기존 열·제약은 안전한 롤아웃과 Flyway 이력 호환을 위해 보존하되 새 PRIVATE 값은 차단.
ALTER TABLE posts ALTER COLUMN visibility SET DEFAULT 'PUBLIC';
ALTER TABLE posts ADD CONSTRAINT ck_posts_public_only CHECK (visibility = 'PUBLIC');
ALTER TABLE projects ADD CONSTRAINT ck_projects_public_only CHECK (visibility = 'PUBLIC');
ALTER TABLE editor_drafts ADD CONSTRAINT ck_editor_drafts_public_only CHECK (visibility = 'PUBLIC');
