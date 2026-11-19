CREATE TABLE IF NOT EXISTS admin_login_attempts (
  bucket TEXT PRIMARY KEY NOT NULL,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS admin_login_attempts_window ON admin_login_attempts(window_start);
