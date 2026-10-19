-- Add six-tier drops without changing any existing drop's committed rules.
begin;
alter table public.foil_listings
  add column emerald_cap integer not null default 0 check (emerald_cap >= 0),
  add column sapphire_cap integer not null default 0 check (sapphire_cap >= 0),
  add column rules_version smallint not null default 1 check (rules_version in (1, 2));
alter table public.foil_listings add constraint foil_listings_six_caps_check
  check (silver_cap + gold_cap + emerald_cap + sapphire_cap + prismatic_cap <= max_supply);
alter table public.mints drop constraint mints_tier_check;
alter table public.mints add constraint mints_tier_check
  check (tier in ('Standard', 'Silver', 'Gold', 'Emerald', 'Sapphire', 'Prismatic'));

create function public.foil_rule_rates(rule_version integer) returns jsonb
language sql immutable set search_path = public as $$
  select case when rule_version = 2 then
    '{"Standard":60,"Silver":20,"Gold":10,"Emerald":6,"Sapphire":3,"Prismatic":1}'::jsonb
  else '{"Standard":70,"Silver":20,"Gold":9,"Prismatic":1}'::jsonb end;
$$;
revoke all on function public.foil_rule_rates(integer) from public;
grant execute on function public.foil_rule_rates(integer) to anon, authenticated, service_role;

create function public.configure_foil_listing_v2(
  target_artwork bigint, active boolean, supply integer, silver integer, gold integer,
  emerald integer, sapphire integer, prismatic integer
) returns void language plpgsql security definer set search_path = public as $$
declare
  art public.artworks%rowtype;
  sig public.artwork_signatures%rowtype;
  cfg public.foil_listings%rowtype;
begin
  if not public.is_admin() then raise exception 'Admin required'; end if;
  if supply is null or silver is null or gold is null or emerald is null or sapphire is null or prismatic is null then
    raise exception 'Supply and all tier caps are required';
  end if;
  select * into art from public.artworks where id = target_artwork for update;
  if not found or art.category = 'NFT' or art.original_path is null then
    raise exception 'Signed image master required';
  end if;
  select * into sig from public.artwork_signatures where artwork_id = target_artwork;
  if not found or sig.serial_number <> art.serial_number or sig.mime_type not in ('image/png','image/jpeg','image/webp') then
    raise exception 'Registered image master required';
  end if;
  select * into cfg from public.foil_listings where artwork_id = target_artwork for update;
  if found and exists(select 1 from public.mints where listing_id = target_artwork) then
    if supply <> cfg.max_supply or silver <> cfg.silver_cap or gold <> cfg.gold_cap
       or emerald <> cfg.emerald_cap or sapphire <> cfg.sapphire_cap or prismatic <> cfg.prismatic_cap then
      raise exception 'Edition caps and odds are locked after first reservation';
    end if;
    -- Pausing/re-enabling an existing edition never upgrades its rules or master.
    update public.foil_listings set enabled = active where artwork_id = target_artwork;
    return;
  end if;
  insert into public.foil_listings(
    artwork_id, enabled, max_supply, silver_cap, gold_cap, emerald_cap, sapphire_cap,
    prismatic_cap, rules_version, master_path, master_sha256, master_record, master_title, master_serial, price
  ) values (
    target_artwork, active, supply, silver, gold, emerald, sapphire, prismatic, 2,
    art.original_path, sig.sha256, to_jsonb(sig)-'original_path', art.title, art.serial_number, art.price
  ) on conflict(artwork_id) do update set
    enabled = active, max_supply = supply, silver_cap = silver, gold_cap = gold,
    emerald_cap = emerald, sapphire_cap = sapphire, prismatic_cap = prismatic, rules_version = 2,
    master_path = excluded.master_path, master_sha256 = excluded.master_sha256,
    master_record = excluded.master_record, master_title = excluded.master_title,
    master_serial = excluded.master_serial, price = excluded.price;
end;
$$;
revoke all on function public.configure_foil_listing_v2(bigint,boolean,integer,integer,integer,integer,integer,integer) from public;
grant execute on function public.configure_foil_listing_v2(bigint,boolean,integer,integer,integer,integer,integer,integer) to authenticated;

-- Older admin clients may still pause legacy drops; they cannot edit six-tier caps.
create or replace function public.configure_foil_listing(
  target_artwork bigint, active boolean, supply integer, silver integer, gold integer, prismatic integer
) returns void language plpgsql security definer set search_path = public as $$
declare
  art public.artworks%rowtype;
  sig public.artwork_signatures%rowtype;
  cfg public.foil_listings%rowtype;
begin
  if not public.is_admin() then raise exception 'Admin required'; end if;
  select * into art from public.artworks where id = target_artwork for update;
  if not found or art.category = 'NFT' or art.original_path is null then raise exception 'Signed image master required'; end if;
  select * into sig from public.artwork_signatures where artwork_id = target_artwork;
  if not found or sig.serial_number <> art.serial_number or sig.mime_type not in ('image/png','image/jpeg','image/webp') then raise exception 'Registered image master required'; end if;
  select * into cfg from public.foil_listings where artwork_id = target_artwork for update;
  if found and cfg.rules_version = 2 then raise exception 'Use the six-tier admin to change this edition'; end if;
  if found and exists(select 1 from public.mints where listing_id = target_artwork) then
    if supply is distinct from cfg.max_supply or silver is distinct from cfg.silver_cap
       or gold is distinct from cfg.gold_cap or prismatic is distinct from cfg.prismatic_cap then
      raise exception 'Edition caps are locked after first reservation';
    end if;
    update public.foil_listings set enabled = active where artwork_id = target_artwork;
    return;
  end if;
  insert into public.foil_listings(artwork_id,enabled,max_supply,silver_cap,gold_cap,prismatic_cap,master_path,master_sha256,master_record,master_title,master_serial,price)
  values(target_artwork,active,supply,silver,gold,prismatic,art.original_path,sig.sha256,to_jsonb(sig)-'original_path',art.title,art.serial_number,art.price)
  on conflict(artwork_id) do update set enabled=active,max_supply=supply,silver_cap=silver,gold_cap=gold,prismatic_cap=prismatic,
    master_path=excluded.master_path,master_sha256=excluded.master_sha256,master_record=excluded.master_record,master_title=excluded.master_title,master_serial=excluded.master_serial,price=excluded.price;
end;
$$;

create or replace function public.allocate_paid_foil(target_order uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  m public.mints%rowtype;
  cfg public.foil_listings%rowtype;
  b integer;
  r integer;
  chosen text;
  n integer;
begin
  select * into m from public.mints where order_id = target_order for update;
  if not found then raise exception 'Missing mint reservation'; end if;
  if m.mint_number is not null then return; end if;
  if m.state <> 'reserved' then raise exception 'Reservation is not payable'; end if;
  select * into cfg from public.foil_listings where artwork_id = m.listing_id for update;
  if cfg.total_minted >= cfg.max_supply then raise exception 'Supply exhausted'; end if;
  loop
    b := get_byte(gen_random_bytes(1), 0);
    exit when b < 200;
  end loop;
  r := (b % 100) + 1;
  if cfg.rules_version = 2 then
    chosen := case when r = 1 then 'Prismatic' when r <= 4 then 'Sapphire'
      when r <= 10 then 'Emerald' when r <= 20 then 'Gold' when r <= 40 then 'Silver' else 'Standard' end;
  else
    chosen := case when r = 1 then 'Prismatic' when r <= 10 then 'Gold' when r <= 30 then 'Silver' else 'Standard' end;
  end if;
  if chosen = 'Prismatic' and (select count(*) from public.mints where listing_id=m.listing_id and tier='Prismatic') >= cfg.prismatic_cap then
    chosen := case when cfg.rules_version=2 then 'Sapphire' else 'Gold' end;
  end if;
  if chosen = 'Sapphire' and (select count(*) from public.mints where listing_id=m.listing_id and tier='Sapphire') >= cfg.sapphire_cap then chosen := 'Emerald'; end if;
  if chosen = 'Emerald' and (select count(*) from public.mints where listing_id=m.listing_id and tier='Emerald') >= cfg.emerald_cap then chosen := 'Gold'; end if;
  if chosen = 'Gold' and (select count(*) from public.mints where listing_id=m.listing_id and tier='Gold') >= cfg.gold_cap then chosen := 'Silver'; end if;
  if chosen = 'Silver' and (select count(*) from public.mints where listing_id=m.listing_id and tier='Silver') >= cfg.silver_cap then chosen := 'Standard'; end if;
  n := cfg.total_minted + 1;
  update public.foil_listings set total_minted=n where artwork_id=m.listing_id;
  update public.mints set state='queued',mint_number=n,tier=chosen,roll=r,paid_at=now(),available_at=now() where id=m.id;
  update public.orders set fulfillment_status='mint_queued' where id=target_order;
end;
$$;

create or replace function public.foil_catalog() returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'artworkId',f.artwork_id,'enabled',f.enabled,'maxSupply',f.max_supply,'totalMinted',f.total_minted,
    'reserved',(select count(*) from public.mints m where m.listing_id=f.artwork_id and m.state='reserved'),
    'prismaticsRemaining',f.prismatic_cap-(select count(*) from public.mints m where m.listing_id=f.artwork_id and m.tier='Prismatic'),
    'silverCap',f.silver_cap,'goldCap',f.gold_cap,'emeraldCap',f.emerald_cap,'sapphireCap',f.sapphire_cap,
    'prismaticCap',f.prismatic_cap,'rulesVersion',f.rules_version,'dropRates',public.foil_rule_rates(f.rules_version),'price',f.price
  )), '[]'::jsonb)
  from public.foil_listings f join public.artworks a on a.id=f.artwork_id where a.status='published';
$$;
create or replace function public.admin_foil_settings(target_artwork bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admin required'; end if;
  return (select jsonb_build_object(
    'enabled',enabled,'maxSupply',max_supply,'silverCap',silver_cap,'goldCap',gold_cap,
    'emeraldCap',emerald_cap,'sapphireCap',sapphire_cap,'prismaticCap',prismatic_cap,
    'totalMinted',total_minted,'rulesVersion',rules_version,'dropRates',public.foil_rule_rates(rules_version),
    'locked',exists(select 1 from public.mints where listing_id=target_artwork)
  ) from public.foil_listings where artwork_id=target_artwork);
end;
$$;
-- Replacements retain the original function privileges. The roll remains service-only.
revoke all on function public.allocate_paid_foil(uuid) from public, anon, authenticated;
grant execute on function public.allocate_paid_foil(uuid) to service_role;
notify pgrst, 'reload schema';
commit;
