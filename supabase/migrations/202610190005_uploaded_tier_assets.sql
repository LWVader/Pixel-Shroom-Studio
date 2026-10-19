begin;
-- Finished tier images are private sources, never public gallery assets.
create table public.foil_tier_assets (
 listing_id bigint not null references public.foil_listings(artwork_id),
 tier text not null check(tier in ('Standard','Silver','Gold','Emerald','Sapphire','Prismatic')),
 path text not null unique,
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 mime_type text not null check(mime_type in ('image/png','image/jpeg','image/webp')),
 width integer not null check(width > 0), height integer not null check(height > 0),
 primary key(listing_id,tier), check(width::bigint * height <= 100000000)
);
alter table public.foil_tier_assets enable row level security;
revoke all on public.foil_tier_assets from public, anon, authenticated;
grant all on public.foil_tier_assets to service_role;
alter table public.mints add column asset_mode text not null default 'legacy'
 check(asset_mode in ('legacy','uploaded'));
alter table public.mints alter column asset_mode set default 'uploaded';
-- Retain previously reserved/paid jobs, but require uploads for all new checkouts.
update public.foil_listings set enabled=false;
update storage.buckets set allowed_mime_types=array['image/png','image/jpeg','image/webp'] where id='minted';

create function public.set_foil_tier_assets(target_artwork bigint, assets jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare a jsonb; expected_ext text;
begin
 if not public.is_admin() then raise exception 'Admin required'; end if;
 perform 1 from public.foil_listings where artwork_id=target_artwork for update;
 if not found then raise exception 'Configure the foil listing first'; end if;
 if exists(select 1 from public.mints where listing_id=target_artwork and asset_mode='uploaded') then
  raise exception 'Tier images are locked after the first uploaded-image reservation';
 end if;
 if jsonb_typeof(assets) is distinct from 'array' or jsonb_array_length(assets) not between 1 and 6 then
  raise exception 'One to six tier images required';
 end if;
 if (select count(distinct value->>'tier') from jsonb_array_elements(assets)) <> jsonb_array_length(assets) then
  raise exception 'Duplicate tiers';
 end if;
 for a in select value from jsonb_array_elements(assets) loop
  expected_ext := case a->>'mimeType' when 'image/png' then 'png' when 'image/jpeg' then 'jpg' when 'image/webp' then 'webp' else null end;
  if expected_ext is null or (a->>'path') is null or
     (a->>'path') !~ ('^foil-tiers/'||target_artwork::text||'/'||lower(a->>'tier')||'/[a-f0-9-]{36}\.'||expected_ext||'$') or
     not exists(select 1 from storage.objects where bucket_id='originals' and name=a->>'path') then
   raise exception 'Private uploaded image required';
  end if;
  insert into public.foil_tier_assets(listing_id,tier,path,sha256,mime_type,width,height)
   values(target_artwork,a->>'tier',a->>'path',a->>'sha256',a->>'mimeType',(a->>'width')::integer,(a->>'height')::integer)
   on conflict(listing_id,tier) do update set path=excluded.path,sha256=excluded.sha256,mime_type=excluded.mime_type,width=excluded.width,height=excluded.height;
 end loop;
end $$;
create function public.admin_foil_tier_assets(target_artwork bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'Admin required'; end if;
 return jsonb_build_object('locked',exists(select 1 from public.mints where listing_id=target_artwork and asset_mode='uploaded'),
 'assets',coalesce((select jsonb_agg(jsonb_build_object('tier',tier,'path',path,'sha256',sha256,'mimeType',mime_type,'width',width,'height',height)) from public.foil_tier_assets where listing_id=target_artwork),'[]'::jsonb));
end $$;
revoke all on function public.set_foil_tier_assets(bigint,jsonb),public.admin_foil_tier_assets(bigint) from public,anon;
grant execute on function public.set_foil_tier_assets(bigint,jsonb),public.admin_foil_tier_assets(bigint) to authenticated;

alter function public.reserve_foil_order(bigint,uuid,text) rename to reserve_foil_order_before_uploads;
revoke all on function public.reserve_foil_order_before_uploads(bigint,uuid,text) from public,anon,authenticated,service_role;
create function public.reserve_foil_order(target_artwork bigint,buyer uuid,token_hash text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 perform 1 from public.foil_listings where artwork_id=target_artwork for update;
 if (select count(*) from public.foil_tier_assets where listing_id=target_artwork) <> 6 then
  raise exception 'Upload all six finished tier images before checkout';
 end if;
 result := public.reserve_foil_order_before_uploads(target_artwork,buyer,token_hash);
 return result;
end $$;
revoke all on function public.reserve_foil_order(bigint,uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_foil_order(bigint,uuid,text) to service_role;

alter function public.foil_catalog() rename to foil_catalog_before_uploads;
revoke all on function public.foil_catalog_before_uploads() from public,anon,authenticated,service_role;
create function public.foil_catalog() returns jsonb language sql security definer set search_path=public as $$
 select coalesce(jsonb_agg(item || jsonb_build_object('enabled',
  coalesce((item->>'enabled')::boolean,false) and (select count(*) from public.foil_tier_assets where listing_id=(item->>'artworkId')::bigint)=6,
  'tierImages',coalesce((select jsonb_agg(jsonb_build_object('tier',tier,'width',width,'height',height,'mimeType',mime_type)) from public.foil_tier_assets where listing_id=(item->>'artworkId')::bigint),'[]'::jsonb),
  'deliveryMode','uploaded')), '[]'::jsonb)
 from jsonb_array_elements(public.foil_catalog_before_uploads()) item;
$$;
revoke all on function public.foil_catalog() from public;
grant execute on function public.foil_catalog() to anon,authenticated,service_role;

alter function public.claim_foil_job() rename to claim_foil_job_before_uploads;
revoke all on function public.claim_foil_job_before_uploads() from public,anon,authenticated,service_role;
create function public.claim_foil_job() returns jsonb language plpgsql security definer set search_path=public as $$
declare job jsonb; source public.foil_tier_assets%rowtype;
begin
 job := public.claim_foil_job_before_uploads();
 if job is null then return null; end if;
 if job->'mint'->>'asset_mode'='uploaded' then
  select * into source from public.foil_tier_assets where listing_id=(job->'mint'->>'listing_id')::bigint and tier=job->'mint'->>'tier';
  job := job || jsonb_build_object('tier_asset',to_jsonb(source));
 end if;
 return job;
end $$;
revoke all on function public.claim_foil_job() from public,anon,authenticated;
grant execute on function public.claim_foil_job() to service_role;

create or replace function public.finish_foil_job(target_mint uuid,lease uuid,artifact text,file_sha256 text,receipt jsonb,image_width integer,image_height integer)
returns boolean language plpgsql security definer set search_path=public as $$
declare m public.mints%rowtype; source public.foil_tier_assets%rowtype; ext text;
begin
 select * into m from public.mints where id=target_mint for update;
 if not found or m.state<>'processing' or m.lease_id is distinct from lease or m.lease_until<=now() then return false; end if;
 ext := case receipt->'payload'->>'mimeType' when 'image/png' then 'png' when 'image/jpeg' then 'jpg' when 'image/webp' then 'webp' else null end;
 if ext is null or artifact<>m.owner_id::text||'/'||m.id::text||'/'||lease::text||'.'||ext or
  file_sha256 !~ '^[0-9a-f]{64}$' or receipt->'payload'->>'sha256' is distinct from file_sha256 or
  receipt->'payload'->>'mintId' is distinct from m.id::text or
  image_width is null or image_height is null or image_width<1 or image_height<1 or image_width::bigint*image_height>100000000 then
  raise exception 'Invalid artifact receipt';
 end if;
 if m.asset_mode='uploaded' then
  select * into source from public.foil_tier_assets where listing_id=m.listing_id and tier=m.tier;
  if not found or source.sha256 is distinct from file_sha256 or source.mime_type is distinct from receipt->'payload'->>'mimeType'
   or source.width<>image_width or source.height<>image_height
   or receipt->'payload'->>'tier' is distinct from m.tier then raise exception 'Uploaded tier copy mismatch'; end if;
 end if;
 update public.mints set state='ready',artifact_path=artifact,crypto_sha256=file_sha256,manifest=receipt,width=image_width,height=image_height,completed_at=now(),lease_id=null,lease_until=null,last_error=null where id=m.id;
 update public.orders set fulfillment_status='mint_ready' where id=m.order_id;
 return true;
end $$;
notify pgrst,'reload schema';
commit;
