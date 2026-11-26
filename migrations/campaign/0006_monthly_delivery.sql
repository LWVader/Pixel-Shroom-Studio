CREATE TABLE IF NOT EXISTS monthly_asset_packs (
  pack_month TEXT PRIMARY KEY NOT NULL,
  object_path TEXT NOT NULL UNIQUE,
  byte_size INTEGER NOT NULL,
  uploaded_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS monthly_asset_deliveries (
  invoice_id TEXT PRIMARY KEY NOT NULL,
  subscription_id TEXT NOT NULL,
  buyer_email TEXT NOT NULL,
  pack_month TEXT NOT NULL,
  paid_at INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','waiting','sending','sent','review')),
  retry_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  first_attempt INTEGER,
  send_payload TEXT,
  provider_id TEXT,
  sent_at INTEGER,
  last_error TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS monthly_deliveries_due ON monthly_asset_deliveries(state, retry_at, lease_until);
