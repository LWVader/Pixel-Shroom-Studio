-- Run only in the intended Supabase project. No public access policies are added.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('monthly-asset-packs', 'monthly-asset-packs', false, 20971520, ARRAY['application/zip'])
ON CONFLICT (id) DO NOTHING;
