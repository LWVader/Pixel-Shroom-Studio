-- Read-only inventory for the INTENDED Supabase project. No customer rows,
-- file contents, secrets, or schema changes. Review before retiring any legacy data.
SELECT schemaname, relname AS table_name, n_live_tup AS estimated_rows
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY relname;

SELECT b.id AS bucket, b.public, b.file_size_limit, count(o.id) AS object_count
FROM storage.buckets b
LEFT JOIN storage.objects o ON o.bucket_id = b.id
GROUP BY b.id, b.public, b.file_size_limit
ORDER BY b.id;

SELECT n.nspname AS schema_name, p.proname AS routine_name,
       pg_get_function_identity_arguments(p.oid) AS arguments
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('is_admin','publish_campaign_zip','publish_campaign_zip_as_admin',
                   'withdraw_campaign_zip_as_admin','record_campaign_email_sent')
ORDER BY p.proname;

SELECT schemaname, tablename, policyname, cmd
FROM pg_policies
WHERE (schemaname = 'public' AND tablename IN ('campaign_briefs','campaign_zip_deliveries','admin_users'))
   OR (schemaname = 'storage' AND tablename = 'objects')
ORDER BY schemaname, tablename, policyname;
