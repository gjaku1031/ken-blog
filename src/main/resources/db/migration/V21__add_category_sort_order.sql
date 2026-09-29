ALTER TABLE categories
    ADD COLUMN sort_order INT NOT NULL DEFAULT 0;

UPDATE categories c
JOIN (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY parent_id ORDER BY path ASC, id ASC) AS position
    FROM categories
) ranked ON ranked.id = c.id
SET c.sort_order = ranked.position;

CREATE INDEX ix_categories_parent_order ON categories(parent_id, sort_order, id);
