-- Migration 0012: instructor portal resources

CREATE TABLE instructor_resources (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  type         TEXT NOT NULL CHECK (type IN ('video','document','image','link','manual')),
  category     TEXT NOT NULL DEFAULT 'General',
  url          TEXT,           -- YouTube URL or external link
  r2_key       TEXT,           -- R2 object key for uploaded files
  filename     TEXT,           -- original filename for display
  sort_order   INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_instructor_resources_type ON instructor_resources(type);
CREATE INDEX idx_instructor_resources_category ON instructor_resources(category);
