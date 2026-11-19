-- The Worker validates industry IDs against the shared publisher catalog.
-- Keep existing slugs, artwork, versions and publication states during the upgrade.
CREATE TABLE portfolio_campaigns_next (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  sector TEXT NOT NULL CHECK (length(sector) > 0),
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

INSERT INTO portfolio_campaigns_next
  (id, name, sector, tagline, brief, creative_value, image_alt, palette, image_webp, published, version, updated_at)
SELECT
  id, name, sector, tagline, brief, creative_value, image_alt, palette, image_webp, published, version, updated_at
FROM portfolio_campaigns;

DROP TABLE portfolio_campaigns;
ALTER TABLE portfolio_campaigns_next RENAME TO portfolio_campaigns;
CREATE INDEX portfolio_campaigns_public ON portfolio_campaigns (published, updated_at DESC, id);
