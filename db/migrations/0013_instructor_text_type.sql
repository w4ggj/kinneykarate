-- Migration 0013: add text resource type and content column

ALTER TABLE instructor_resources ADD COLUMN content TEXT;

-- Recreate table to update CHECK constraint to include 'text'
CREATE TABLE instructor_resources_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  type         TEXT NOT NULL CHECK (type IN ('video','document','image','link','manual','text')),
  category     TEXT NOT NULL DEFAULT 'General',
  url          TEXT,
  r2_key       TEXT,
  filename     TEXT,
  content      TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO instructor_resources_new
  SELECT id, title, description, type, category, url, r2_key, filename, content, sort_order, active, created_at
  FROM instructor_resources;

DROP TABLE instructor_resources;
ALTER TABLE instructor_resources_new RENAME TO instructor_resources;

CREATE INDEX idx_instructor_resources_type ON instructor_resources(type);
CREATE INDEX idx_instructor_resources_category ON instructor_resources(category);
