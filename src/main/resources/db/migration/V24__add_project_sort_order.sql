ALTER TABLE projects
    ADD COLUMN sort_order BIGINT NOT NULL DEFAULT 0;

UPDATE projects p
JOIN (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at DESC, id DESC) AS position
    FROM projects
) ranked ON ranked.id = p.id
SET p.sort_order = ranked.position;

CREATE INDEX ix_projects_sort_order ON projects(sort_order, id DESC);
