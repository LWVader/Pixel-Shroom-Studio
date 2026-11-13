-- Installing this migration does not delete data. An administrator must preview and confirm.
create function public.preview_storefront_reset() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  counts jsonb;
  legacy_table text;
  legacy_count bigint;
begin
  if auth.uid() is null or not coalesce(public.is_admin(), false) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  counts := (
    select jsonb_object_agg(table_name, row_count)
    from (
      select 'artworks' as table_name, count(*) as row_count from public.artworks
      union all select 'artwork_signatures', count(*) from public.artwork_signatures
      union all select 'articles', count(*) from public.articles
      union all select 'contact_messages', count(*) from public.contact_messages
      union all select 'catalog_relaunch_runs', count(*) from public.catalog_relaunch_runs
      union all select 'orders', count(*) from public.orders
      union all select 'licenses', count(*) from public.licenses
      union all select 'webhook_events', count(*) from public.webhook_events
      union all select 'foil_listings', count(*) from public.foil_listings
      union all select 'foil_tier_assets', count(*) from public.foil_tier_assets
      union all select 'foil_copy_inventory', count(*) from public.foil_copy_inventory
      union all select 'mints', count(*) from public.mints
      union all select 'market_sellers', count(*) from public.market_sellers
      union all select 'secondary_market', count(*) from public.secondary_market
      union all select 'market_purchases', count(*) from public.market_purchases
      union all select 'market_transfers', count(*) from public.market_transfers
      union all select 'market_events', count(*) from public.market_events
      union all select 'market_preview_jobs', count(*) from public.market_preview_jobs
      union all select 'gelato_products', count(*) from public.gelato_products
      union all select 'gelato_quotes', count(*) from public.gelato_quotes
      union all select 'gelato_orders', count(*) from public.gelato_orders
      union all select 'gelato_events', count(*) from public.gelato_events
      union all select 'forge_print_purchases', count(*) from public.forge_print_purchases
      union all select 'canvas_claims', count(*) from public.canvas_claims
      union all select 'forge_operations', count(*) from public.forge_operations
      union all select 'forge_inputs', count(*) from public.forge_inputs
      union all select 'vault_profiles', count(*) from public.vault_profiles
    ) as table_counts
  );
  -- Older installations may still have the retired physical checkout tables.
  foreach legacy_table in array array['physical_orders', 'physical_products'] loop
    if pg_catalog.to_regclass('public.' || legacy_table) is not null then
      execute pg_catalog.format('select count(*) from public.%I', legacy_table) into legacy_count;
      counts := counts || pg_catalog.jsonb_build_object(legacy_table, legacy_count);
    end if;
  end loop;
  return counts;
end;
$$;

create function public.reset_test_storefront(expected_counts jsonb, confirmation text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  current_counts jsonb;
  legacy_table text;
  legacy_tables text[] := array[]::text[];
begin
  if auth.uid() is null or not coalesce(public.is_admin(), false) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if confirmation is distinct from 'RESET TEST STOREFRONT' or expected_counts is null then
    raise exception 'Preview the reset and enter the exact confirmation phrase';
  end if;

  -- Lock first, then compare the preview and clear the explicitly scoped graph atomically.
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  lock table
    public.artworks, public.artwork_signatures, public.articles, public.contact_messages,
    public.catalog_relaunch_runs, public.orders, public.licenses, public.webhook_events,
    public.foil_listings, public.foil_tier_assets, public.foil_copy_inventory, public.mints,
    public.market_sellers, public.secondary_market, public.market_purchases, public.market_transfers,
    public.market_events, public.market_preview_jobs, public.gelato_products, public.gelato_quotes,
    public.gelato_orders, public.gelato_events, public.forge_print_purchases, public.canvas_claims,
    public.forge_operations, public.forge_inputs, public.vault_profiles
  in access exclusive mode;

  foreach legacy_table in array array['physical_orders', 'physical_products'] loop
    if pg_catalog.to_regclass('public.' || legacy_table) is not null then
      execute pg_catalog.format('lock table public.%I in access exclusive mode', legacy_table);
      legacy_tables := pg_catalog.array_append(legacy_tables, pg_catalog.format('public.%I', legacy_table));
    end if;
  end loop;

  current_counts := public.preview_storefront_reset();
  if current_counts is distinct from expected_counts then
    raise exception 'Storefront counts changed. Preview the reset again';
  end if;

  execute $truncate$truncate table
    public.artworks, public.artwork_signatures, public.articles, public.contact_messages,
    public.catalog_relaunch_runs, public.orders, public.licenses, public.webhook_events,
    public.foil_listings, public.foil_tier_assets, public.foil_copy_inventory, public.mints,
    public.market_sellers, public.secondary_market, public.market_purchases, public.market_transfers,
    public.market_events, public.market_preview_jobs, public.gelato_products, public.gelato_quotes,
    public.gelato_orders, public.gelato_events, public.forge_print_purchases, public.canvas_claims,
    public.forge_operations, public.forge_inputs, public.vault_profiles
  $truncate$ || case
    when pg_catalog.cardinality(legacy_tables) > 0 then ', ' || pg_catalog.array_to_string(legacy_tables, ', ')
    else ''
  end || ' continue identity restrict';

  return current_counts;
end;
$$;

revoke all on function public.preview_storefront_reset() from public, anon, authenticated;
revoke all on function public.reset_test_storefront(jsonb, text) from public, anon, authenticated;
grant execute on function public.preview_storefront_reset() to authenticated;
grant execute on function public.reset_test_storefront(jsonb, text) to authenticated;
notify pgrst, 'reload schema';
