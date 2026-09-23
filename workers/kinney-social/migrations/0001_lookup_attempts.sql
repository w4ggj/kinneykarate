-- Rate-limit ledger for POST /api/lookup. created_at is ISO-8601 (written by the worker)
-- so it string-compares correctly against the cutoff in isLockedOut().
CREATE TABLE IF NOT EXISTS lookup_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ip         TEXT    NOT NULL,
  success    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_lookup_attempts_ip_created ON lookup_attempts (ip, created_at);
