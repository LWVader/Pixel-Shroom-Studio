ALTER TABLE campaign_briefs ADD COLUMN fulfillment_stage TEXT NOT NULL DEFAULT 'new'
  CHECK (fulfillment_stage IN ('new', 'production', 'ready', 'delivered'));
ALTER TABLE campaign_briefs ADD COLUMN stage_updated_at TEXT;
UPDATE campaign_briefs SET fulfillment_stage = 'delivered', stage_updated_at = email_delivered_at
  WHERE email_delivered_at IS NOT NULL;

CREATE TABLE portfolio_campaigns (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  sector TEXT NOT NULL CHECK (sector IN ('food','games','music','fashion','other')),
  tagline TEXT NOT NULL,
  brief TEXT NOT NULL,
  creative_value TEXT NOT NULL,
  image_alt TEXT NOT NULL,
  palette TEXT NOT NULL,
  image_webp TEXT NOT NULL,
  published INTEGER NOT NULL CHECK (published IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX portfolio_campaigns_public ON portfolio_campaigns (published, updated_at DESC, id);
