-- Instagram publish state per approved submission, so a post goes out at most once even
-- with several staff clicking and the cron retrying. See src/instagram.js for the states.
CREATE TABLE IF NOT EXISTS ig_publish (
  submission_id  TEXT PRIMARY KEY,
  state          TEXT NOT NULL CHECK (state IN ('creating', 'processing', 'publishing', 'published', 'done', 'error')),
  container_id   TEXT,
  media_id       TEXT,
  error          TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ig_publish_state ON ig_publish (state);
