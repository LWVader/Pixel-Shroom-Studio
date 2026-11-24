ALTER TABLE portfolio_campaigns ADD COLUMN image_preview_webp TEXT;

CREATE INDEX portfolio_campaigns_protected
  ON portfolio_campaigns (updated_at DESC, id)
  WHERE published = 1 AND image_preview_webp IS NOT NULL;
