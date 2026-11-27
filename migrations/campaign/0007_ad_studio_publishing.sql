-- Use the existing campaign D1 database only when AD_STUDIO_DB is not bound.
CREATE TABLE IF NOT EXISTS publishing_credentials (
  user_id TEXT PRIMARY KEY NOT NULL,
  encrypted TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS publishing_submissions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL
);
