-- For the dedicated monthly ZIP bucket only; never change a public bucket.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('monthly-asset-packs', 'monthly-asset-packs', false, 26214400, ARRAY['application/zip'])
ON CONFLICT (id) DO NOTHING;
UPDATE storage.buckets
SET file_size_limit = 26214400
WHERE id = 'monthly-asset-packs' AND public = false
  AND file_size_limit IS NOT NULL AND file_size_limit < 26214400;
