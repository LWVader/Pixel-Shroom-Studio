-- Disable the retired site's physical checkout. Preserve any historical order records.
-- The eBay storefront uses only public metadata and outgoing links, never these tables.
drop function if exists public.claim_physical_payment(uuid,text,text,integer,integer,text);
do $$
begin
  if to_regclass('public.physical_orders') is not null then
    revoke all on public.physical_orders from anon, authenticated, service_role;
  end if;
  if to_regclass('public.physical_products') is not null then
    revoke all on public.physical_products from anon, authenticated, service_role;
  end if;
end $$;
