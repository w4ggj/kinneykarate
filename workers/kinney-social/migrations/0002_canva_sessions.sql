-- One row per in-progress student design. id is the opaque session token the browser
-- holds after lookup; rows are deleted on submit or after 24h (see SESSION_TTL_HOURS).
CREATE TABLE IF NOT EXISTS canva_sessions (
  id             TEXT PRIMARY KEY,
  student_id     TEXT NOT NULL,
  oauth_state    TEXT UNIQUE,
  code_verifier  TEXT,
  access_token   TEXT,
  refresh_token  TEXT,
  design_id      TEXT,
  edit_url       TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_canva_sessions_created ON canva_sessions (created_at);
