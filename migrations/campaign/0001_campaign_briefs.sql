CREATE TABLE IF NOT EXISTS campaign_briefs (
  checkout_session_id TEXT PRIMARY KEY NOT NULL,
  offer TEXT NOT NULL CHECK (offer IN ('attention', 'monthly')),
  buyer_email TEXT NOT NULL,
  business TEXT NOT NULL,
  industry TEXT NOT NULL,
  vibe TEXT NOT NULL,
  colors TEXT NOT NULL,
  goal TEXT NOT NULL,
  landing_session_id TEXT UNIQUE,
  landing_paid_at TEXT,
  email_delivered_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX IF NOT EXISTS campaign_briefs_created
  ON campaign_briefs (created_at DESC, checkout_session_id);
