begin;
alter table public.mints drop constraint mints_asset_mode_check;
alter table public.mints add constraint mints_asset_mode_check check(asset_mode in ('legacy','uploaded','inventory'));
alter table public.mints alter column asset_mode set default 'inventory';
create table public.foil_copy_inventory (
 id uuid primary key default gen_random_uuid(), listing_id bigint not null, tier text not null,
 copy_number integer not null check(copy_number>0), source_sha256 text not null,
 state text not null default 'queued' check(state in ('queued','preparing','ready','assigned','failed')),
 sha256 text unique, mint_id uuid unique references public.mints(id),
 lease_id uuid, lease_until timestamptz, available_at timestamptz not null default now(), attempts integer not null default 0,
 foreign key(listing_id,tier) references public.foil_tier_assets(listing_id,tier),
 unique(listing_id,tier,copy_number), check(sha256 is null or sha256 ~ '^[0-9a-f]{64}$')
);
alter table public.mints add column copy_id uuid unique references public.foil_copy_inventory(id);
alter table public.foil_copy_inventory enable row level security;
revoke all on public.foil_copy_inventory from public,anon,authenticated;
grant all on public.foil_copy_inventory to service_role;
create index foil_inventory_queue on public.foil_copy_inventory(state,available_at);

create function public.queue_foil_inventory(target bigint) returns void language plpgsql security definer set search_path=public as $$
declare cfg public.foil_listings%rowtype; a public.foil_tier_assets%rowtype; quantity integer;
begin
 select * into cfg from public.foil_listings where artwork_id=target for update;
 if not found or exists(select 1 from public.mints where listing_id=target and asset_mode='inventory') then return; end if;
 for a in select * from public.foil_tier_assets where listing_id=target loop
  quantity := case a.tier when 'Standard' then cfg.max_supply when 'Silver' then cfg.silver_cap when 'Gold' then cfg.gold_cap when 'Emerald' then cfg.emerald_cap when 'Sapphire' then cfg.sapphire_cap when 'Prismatic' then cfg.prismatic_cap end;
  delete from public.foil_copy_inventory where listing_id=target and tier=a.tier and copy_number>quantity;
  insert into public.foil_copy_inventory(listing_id,tier,copy_number,source_sha256)
   select target,a.tier,n,a.sha256 from generate_series(1,quantity) n
   on conflict(listing_id,tier,copy_number) do update set source_sha256=excluded.source_sha256,
    state='queued',sha256=null,lease_id=null,lease_until=null,available_at=now(),attempts=0
   where public.foil_copy_inventory.source_sha256 is distinct from excluded.source_sha256 or public.foil_copy_inventory.state='failed';
 end loop;
end $$;
revoke all on function public.queue_foil_inventory(bigint) from public,anon,authenticated;
create function public.queue_changed_foil_inventory() returns trigger language plpgsql security definer set search_path=public as $$
begin
 perform public.queue_foil_inventory(new.listing_id);
 return new;
end $$;
create trigger queue_tier_copies after insert or update on public.foil_tier_assets for each row execute function public.queue_changed_foil_inventory();
-- Separate trigger avoids accessing a non-existent record field in the assets trigger.
create function public.queue_changed_foil_config() returns trigger language plpgsql security definer set search_path=public as $$
begin perform public.queue_foil_inventory(new.artwork_id); return new; end $$;
create trigger queue_config_copies after update of max_supply,silver_cap,gold_cap,emerald_cap,sapphire_cap,prismatic_cap on public.foil_listings for each row execute function public.queue_changed_foil_config();

alter function public.set_foil_tier_assets(bigint,jsonb) rename to set_foil_tier_assets_v5;
revoke all on function public.set_foil_tier_assets_v5(bigint,jsonb) from public,anon,authenticated,service_role;
create function public.set_foil_tier_assets(target_artwork bigint,assets jsonb) returns void language plpgsql security definer set search_path=public as $$
begin
 perform 1 from public.foil_listings where artwork_id=target_artwork for update;
 if exists(select 1 from public.mints where listing_id=target_artwork and asset_mode='inventory') then raise exception 'Tier images are locked after first reservation'; end if;
 perform public.set_foil_tier_assets_v5(target_artwork,assets);
end $$;
revoke all on function public.set_foil_tier_assets(bigint,jsonb) from public,anon;
grant execute on function public.set_foil_tier_assets(bigint,jsonb) to authenticated;

create function public.foil_inventory_ready(target bigint) returns boolean language sql stable security definer set search_path=public as $$
 select (select count(*) from public.foil_tier_assets where listing_id=target)=6 and
  (select count(*) from public.foil_copy_inventory where listing_id=target and state in ('ready','assigned')) =
  (select max_supply+silver_cap+gold_cap+emerald_cap+sapphire_cap+prismatic_cap from public.foil_listings where artwork_id=target);
$$;
revoke all on function public.foil_inventory_ready(bigint) from public,anon,authenticated;
alter function public.reserve_foil_order(bigint,uuid,text) rename to reserve_foil_order_v5;
revoke all on function public.reserve_foil_order_v5(bigint,uuid,text) from public,anon,authenticated,service_role;
create function public.reserve_foil_order(target_artwork bigint,buyer uuid,token_hash text) returns jsonb language plpgsql security definer set search_path=public as $$
begin
 perform 1 from public.foil_listings where artwork_id=target_artwork for update;
 if not coalesce(public.foil_inventory_ready(target_artwork),false) then raise exception 'Copy hashes are still being prepared'; end if;
 return public.reserve_foil_order_v5(target_artwork,buyer,token_hash);
end $$;
revoke all on function public.reserve_foil_order(bigint,uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_foil_order(bigint,uuid,text) to service_role;

create function public.assign_paid_copy() returns trigger language plpgsql security definer set search_path=public as $$
declare selected uuid;
begin
 if new.asset_mode='inventory' and new.tier is not null and old.tier is null then
  select id into selected from public.foil_copy_inventory where listing_id=new.listing_id and tier=new.tier and state='ready' order by copy_number for update skip locked limit 1;
  if selected is null then raise exception 'Prepared copy unavailable'; end if;
  update public.foil_copy_inventory set state='assigned',mint_id=new.id where id=selected;
  update public.mints set copy_id=selected where id=new.id;
 end if;
 return new;
end $$;
create trigger assign_paid_foil_copy after update of tier on public.mints for each row execute function public.assign_paid_copy();

create function public.claim_foil_copy_batch() returns jsonb language plpgsql security definer set search_path=public as $$
declare selected public.foil_copy_inventory%rowtype; result jsonb; token uuid:=gen_random_uuid();
begin
 update public.foil_copy_inventory set state='failed',lease_id=null,lease_until=null where state='preparing' and lease_until<now() and attempts>=5;
 select * into selected from public.foil_copy_inventory where (state='queued' and available_at<=now()) or (state='preparing' and lease_until<now()) order by listing_id,tier,copy_number for update skip locked limit 1;
 if not found then return null; end if;
 with chosen as (select id from public.foil_copy_inventory where listing_id=selected.listing_id and tier=selected.tier and ((state='queued' and available_at<=now()) or (state='preparing' and lease_until<now())) order by copy_number for update skip locked limit 25),
 updated as (update public.foil_copy_inventory set state='preparing',lease_id=token,lease_until=now()+interval '10 minutes',attempts=attempts+1 where id in(select id from chosen) returning *)
 select jsonb_agg(to_jsonb(updated)) into result from updated;
 return jsonb_build_object('copies',result,'source',(select to_jsonb(a) from public.foil_tier_assets a where listing_id=selected.listing_id and tier=selected.tier));
end $$;
create function public.finish_foil_copy(target uuid,lease uuid,digest text) returns boolean language plpgsql security definer set search_path=public as $$
begin
 if digest is null or digest !~ '^[0-9a-f]{64}$' then raise exception 'Valid file hash required'; end if;
 update public.foil_copy_inventory c set state='ready',sha256=digest,lease_id=null,lease_until=null where id=target and state='preparing' and lease_id=lease and lease_until>now()
  and source_sha256=(select a.sha256 from public.foil_tier_assets a where a.listing_id=c.listing_id and a.tier=c.tier);
 return found;
end $$;
create function public.fail_foil_copy(target uuid,lease uuid) returns void language sql security definer set search_path=public as $$
 update public.foil_copy_inventory set state=case when attempts>=5 then 'failed' else 'queued' end,available_at=now()+interval '2 minutes',lease_id=null,lease_until=null where id=target and state='preparing' and lease_id=lease;
$$;
revoke all on function public.claim_foil_copy_batch(),public.finish_foil_copy(uuid,uuid,text),public.fail_foil_copy(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_foil_copy_batch(),public.finish_foil_copy(uuid,uuid,text),public.fail_foil_copy(uuid,uuid) to service_role;

alter function public.claim_foil_job() rename to claim_foil_job_v5;
revoke all on function public.claim_foil_job_v5() from public,anon,authenticated,service_role;
create function public.claim_foil_job() returns jsonb language plpgsql security definer set search_path=public as $$
declare job jsonb;
begin
 job:=public.claim_foil_job_v5();
 if job->'mint'->>'asset_mode'='inventory' then
  job:=job||jsonb_build_object('tier_asset',(select to_jsonb(a) from public.foil_tier_assets a where listing_id=(job->'mint'->>'listing_id')::bigint and tier=job->'mint'->>'tier'),
   'copy',(select to_jsonb(c) from public.foil_copy_inventory c where id=(job->'mint'->>'copy_id')::uuid));
 end if;
 return job;
end $$;
revoke all on function public.claim_foil_job() from public,anon,authenticated;
grant execute on function public.claim_foil_job() to service_role;
alter function public.finish_foil_job(uuid,uuid,text,text,jsonb,integer,integer) rename to finish_foil_job_v5;
revoke all on function public.finish_foil_job_v5(uuid,uuid,text,text,jsonb,integer,integer) from public,anon,authenticated,service_role;
create function public.finish_foil_job(target_mint uuid,lease uuid,artifact text,file_sha256 text,receipt jsonb,image_width integer,image_height integer) returns boolean language plpgsql security definer set search_path=public as $$
declare m public.mints%rowtype; c public.foil_copy_inventory%rowtype;
begin
 select * into m from public.mints where id=target_mint for update;
 if m.asset_mode='inventory' then
  select * into c from public.foil_copy_inventory where id=m.copy_id;
  if c.mint_id is distinct from m.id or c.sha256 is distinct from file_sha256 or c.state<>'assigned' or receipt->'payload'->>'copyId' is distinct from c.id::text or receipt->'payload'->>'tier' is distinct from m.tier then raise exception 'Assigned copy mismatch'; end if;
 end if;
 return public.finish_foil_job_v5(target_mint,lease,artifact,file_sha256,receipt,image_width,image_height);
end $$;
revoke all on function public.finish_foil_job(uuid,uuid,text,text,jsonb,integer,integer) from public,anon,authenticated;
grant execute on function public.finish_foil_job(uuid,uuid,text,text,jsonb,integer,integer) to service_role;

alter function public.foil_catalog() rename to foil_catalog_v5;
revoke all on function public.foil_catalog_v5() from public,anon,authenticated,service_role;
create function public.foil_catalog() returns jsonb language sql security definer set search_path=public as $$
 select coalesce(jsonb_agg(item||jsonb_build_object('enabled',coalesce((item->>'enabled')::boolean,false) and coalesce(public.foil_inventory_ready((item->>'artworkId')::bigint),false),'deliveryMode','inventory')),'[]'::jsonb) from jsonb_array_elements(public.foil_catalog_v5()) item;
$$;
revoke all on function public.foil_catalog() from public;
grant execute on function public.foil_catalog() to anon,authenticated,service_role;
alter function public.admin_foil_tier_assets(bigint) rename to admin_foil_tier_assets_v5;
revoke all on function public.admin_foil_tier_assets_v5(bigint) from public,anon,authenticated,service_role;
create function public.admin_foil_tier_assets(target_artwork bigint) returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'Admin required'; end if;
 return public.admin_foil_tier_assets_v5(target_artwork)||jsonb_build_object('locked',exists(select 1 from public.mints where listing_id=target_artwork and asset_mode in ('uploaded','inventory')),
 'inventoryReady',coalesce(public.foil_inventory_ready(target_artwork),false),'prepared',(select count(*) from public.foil_copy_inventory where listing_id=target_artwork and state in ('ready','assigned')),'authorized',(select count(*) from public.foil_copy_inventory where listing_id=target_artwork));
end $$;
revoke all on function public.admin_foil_tier_assets(bigint) from public,anon;
grant execute on function public.admin_foil_tier_assets(bigint) to authenticated;

-- A draft is the only way to save an incomplete foil upload.
alter table public.artworks add column requires_tier_images boolean not null default false;
update public.artworks set requires_tier_images=true,status=case when (select count(*) from public.foil_tier_assets where listing_id=artworks.id)=6 then status else 'draft' end where id in(select artwork_id from public.foil_listings);
create function public.require_six_images_to_publish() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status='published' and (new.requires_tier_images or exists(select 1 from public.foil_listings where artwork_id=new.id) or (new.category<>'NFT' and (tg_op='INSERT' or old.status is distinct from 'published'))) and (select count(*) from public.foil_tier_assets where listing_id=new.id)<>6 then raise exception 'All six tier images are required before publishing'; end if;
 return new;
end $$;
create trigger enforce_six_images_before_publish before insert or update on public.artworks for each row execute function public.require_six_images_to_publish();
create function public.mark_foil_artwork() returns trigger language plpgsql security definer set search_path=public as $$
begin
 update public.artworks set requires_tier_images=true,status=case when (select count(*) from public.foil_tier_assets where listing_id=new.artwork_id)=6 then status else 'draft' end where id=new.artwork_id;
 return new;
end $$;
create trigger mark_foil_artwork after insert on public.foil_listings for each row execute function public.mark_foil_artwork();
-- Existing paid/uploaded jobs retain their already-promised bytes and hashes.
do $$ declare cfg record; begin for cfg in select artwork_id from public.foil_listings loop perform public.queue_foil_inventory(cfg.artwork_id); end loop; end $$;
notify pgrst,'reload schema';
commit;
