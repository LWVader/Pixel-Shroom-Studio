-- Opt-in foil editions. Existing artworks and digital purchases remain unchanged.
begin;
alter table public.orders add column if not exists sale_kind text not null default 'digital';
alter table public.orders add constraint orders_sale_kind_check check (sale_kind in ('digital','foil'));
create table public.foil_listings (
 artwork_id bigint primary key references public.artworks(id), enabled boolean not null default false,
 max_supply integer not null check(max_supply between 1 and 100000), total_minted integer not null default 0,
 silver_cap integer not null check(silver_cap>=0), gold_cap integer not null check(gold_cap>=0), prismatic_cap integer not null check(prismatic_cap>=0),
 master_path text not null, master_sha256 text not null check(master_sha256 ~ '^[0-9a-f]{64}$'), master_record jsonb not null,
 master_title text not null, master_serial text not null, price numeric(10,2) not null check(price>0),
 created_at timestamptz not null default now(),
 check(total_minted between 0 and max_supply), check(silver_cap+gold_cap+prismatic_cap<=max_supply)
);
create table public.foil_keys (key_id text primary key, public_key_jwk jsonb not null, created_at timestamptz not null default now());
create table public.mints (
 id uuid primary key default gen_random_uuid(), listing_id bigint not null references public.foil_listings(artwork_id),
 order_id uuid not null unique references public.orders(id), owner_id uuid not null references auth.users(id),
 state text not null default 'reserved' check(state in ('reserved','queued','processing','ready','released','failed')),
 mint_number integer, tier text check(tier in ('Standard','Silver','Gold','Prismatic')), roll integer check(roll between 1 and 100),
 artifact_path text, crypto_sha256 text, manifest jsonb, width integer, height integer,
 attempts integer not null default 0, available_at timestamptz not null default now(), lease_id uuid, lease_until timestamptz,
 last_error text, created_at timestamptz not null default now(), paid_at timestamptz, completed_at timestamptz,
 unique(listing_id,mint_number), check((mint_number is null)=(tier is null))
);
create index mints_queue on public.mints(state,available_at);
create index mints_owner on public.mints(owner_id,created_at desc);
alter table public.foil_listings enable row level security;
alter table public.mints enable row level security;
alter table public.foil_keys enable row level security;
-- Only RPCs expose aggregate counts. Private master paths and buyer records never become public.
revoke all on public.foil_listings, public.mints, public.foil_keys from anon, authenticated;
grant all on public.foil_listings, public.mints, public.foil_keys to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('minted','minted',false,104857600,array['image/webp']) on conflict(id) do update set public=false;

create function public.configure_foil_listing(target_artwork bigint, active boolean, supply integer, silver integer, gold integer, prismatic integer)
returns void language plpgsql security definer set search_path=public as $$
declare art public.artworks%rowtype; sig public.artwork_signatures%rowtype; cfg public.foil_listings%rowtype;
begin
 if not public.is_admin() then raise exception 'Admin required'; end if;
 select * into art from public.artworks where id=target_artwork for update;
 if not found or art.category='NFT' or art.original_path is null then raise exception 'Signed image master required'; end if;
 select * into sig from public.artwork_signatures where artwork_id=target_artwork;
 if not found or sig.serial_number<>art.serial_number or sig.mime_type not in ('image/png','image/jpeg','image/webp') then raise exception 'Registered image master required'; end if;
 select * into cfg from public.foil_listings where artwork_id=target_artwork for update;
 if found and exists(select 1 from public.mints where listing_id=target_artwork) then
  if supply<>cfg.max_supply or silver<>cfg.silver_cap or gold<>cfg.gold_cap or prismatic<>cfg.prismatic_cap then raise exception 'Edition caps are locked after first reservation'; end if;
  update public.foil_listings set enabled=active where artwork_id=target_artwork;
  return;
 end if;
 insert into public.foil_listings(artwork_id,enabled,max_supply,silver_cap,gold_cap,prismatic_cap,master_path,master_sha256,master_record,master_title,master_serial,price)
 values(target_artwork,active,supply,silver,gold,prismatic,art.original_path,sig.sha256,to_jsonb(sig)-'original_path',art.title,art.serial_number,art.price)
 on conflict(artwork_id) do update set enabled=active,max_supply=supply,silver_cap=silver,gold_cap=gold,prismatic_cap=prismatic,
 master_path=excluded.master_path,master_sha256=excluded.master_sha256,master_record=excluded.master_record,master_title=excluded.master_title,master_serial=excluded.master_serial,price=excluded.price;
end $$;
revoke all on function public.configure_foil_listing(bigint,boolean,integer,integer,integer,integer) from public;
grant execute on function public.configure_foil_listing(bigint,boolean,integer,integer,integer,integer) to authenticated;

create function public.foil_catalog() returns jsonb language sql security definer set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('artworkId',f.artwork_id,'enabled',f.enabled,'maxSupply',f.max_supply,'totalMinted',f.total_minted,
 'reserved',(select count(*) from public.mints m where m.listing_id=f.artwork_id and m.state='reserved'),
 'prismaticsRemaining',f.prismatic_cap-(select count(*) from public.mints m where m.listing_id=f.artwork_id and m.tier='Prismatic'),
 'silverCap',f.silver_cap,'goldCap',f.gold_cap,'prismaticCap',f.prismatic_cap,'price',f.price)), '[]'::jsonb)
 from public.foil_listings f join public.artworks a on a.id=f.artwork_id where a.status='published';
$$;
revoke all on function public.foil_catalog() from public;
grant execute on function public.foil_catalog() to anon,authenticated,service_role;

create function public.reserve_foil_order(target_artwork bigint, buyer uuid, token_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare cfg public.foil_listings%rowtype; purchase uuid; mint uuid;
begin
 select f.* into cfg from public.foil_listings f join public.artworks a on a.id=f.artwork_id
 where f.artwork_id=target_artwork and f.enabled and a.status='published' for update of f;
 if not found then raise exception 'Foil edition unavailable'; end if;
 if cfg.total_minted+(select count(*) from public.mints where listing_id=target_artwork and state='reserved')>=cfg.max_supply then raise exception 'All edition slots are minted or reserved'; end if;
 if buyer is null or token_hash !~ '^[0-9a-f]{64}$' then raise exception 'Buyer credentials required'; end if;
 insert into public.orders(artwork_id,provider,status,amount,currency,access_token_hash,sale_kind)
 values(target_artwork,'stripe','pending',cfg.price,'usd',token_hash,'foil') returning id into purchase;
 insert into public.mints(listing_id,order_id,owner_id) values(target_artwork,purchase,buyer) returning id into mint;
 return jsonb_build_object('orderId',purchase,'mintId',mint,'title',cfg.master_title,'price',cfg.price);
end $$;

create function public.release_foil_order(target_order uuid, checkout_session text)
returns void language plpgsql security definer set search_path=public as $$
declare purchase public.orders%rowtype;
begin
 select * into purchase from public.orders where id=target_order for update;
 if not found or purchase.sale_kind<>'foil' or purchase.status<>'pending' or purchase.provider_order_id is distinct from checkout_session then return; end if;
 perform 1 from public.foil_listings where artwork_id=purchase.artwork_id for update;
 update public.mints set state='released' where order_id=target_order and state='reserved';
 update public.orders set status='failed' where id=target_order;
end $$;

-- Called only from verified payment fulfillment. Randomness is generated inside the
-- transaction, not accepted from the client, and never regenerated on event replay.
create function public.allocate_paid_foil(target_order uuid) returns void
language plpgsql security definer set search_path=public,extensions as $$
declare m public.mints%rowtype; cfg public.foil_listings%rowtype; b integer; r integer; chosen text; n integer;
begin
 select * into m from public.mints where order_id=target_order for update;
 if not found then raise exception 'Missing mint reservation'; end if;
 if m.mint_number is not null then return; end if;
 if m.state<>'reserved' then raise exception 'Reservation is not payable'; end if;
 select * into cfg from public.foil_listings where artwork_id=m.listing_id for update;
 if cfg.total_minted>=cfg.max_supply then raise exception 'Supply exhausted'; end if;
 -- Unbiased rejection sampling: 0..199 yields exactly two of each 1..100 outcome.
 loop b:=get_byte(gen_random_bytes(1),0); exit when b<200; end loop;
 r:=(b%100)+1;
 chosen:=case when r=1 then 'Prismatic' when r<=10 then 'Gold' when r<=30 then 'Silver' else 'Standard' end;
 if chosen='Prismatic' and (select count(*) from public.mints where listing_id=m.listing_id and tier='Prismatic')>=cfg.prismatic_cap then chosen:='Gold'; end if;
 if chosen='Gold' and (select count(*) from public.mints where listing_id=m.listing_id and tier='Gold')>=cfg.gold_cap then chosen:='Silver'; end if;
 if chosen='Silver' and (select count(*) from public.mints where listing_id=m.listing_id and tier='Silver')>=cfg.silver_cap then chosen:='Standard'; end if;
 n:=cfg.total_minted+1;
 update public.foil_listings set total_minted=n where artwork_id=m.listing_id;
 update public.mints set state='queued',mint_number=n,tier=chosen,roll=r,paid_at=now(),available_at=now() where id=m.id;
 update public.orders set fulfillment_status='mint_queued' where id=target_order;
end $$;

-- Preserve the digital fulfillment implementation while branching foil orders.
alter function public.fulfill_verified_order(text,text,text,uuid,numeric,text,text) rename to fulfill_digital_order_legacy;
create function public.fulfill_verified_order(payment_provider text,payment_event_id text,provider_reference text,local_order_id uuid,paid_amount numeric,paid_currency text,customer_email text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare purchase public.orders%rowtype; inserted integer;
begin
 select * into purchase from public.orders where id=local_order_id for update;
 if not found then raise exception 'Order not found'; end if;
 if purchase.sale_kind='digital' then return public.fulfill_digital_order_legacy(payment_provider,payment_event_id,provider_reference,local_order_id,paid_amount,paid_currency,customer_email); end if;
 if payment_provider<>'stripe' or coalesce(payment_event_id,'')='' or purchase.provider<>payment_provider or purchase.provider_order_id is distinct from provider_reference or purchase.amount is distinct from paid_amount or lower(purchase.currency) is distinct from lower(paid_currency) or purchase.status not in ('pending','paid') then raise exception 'Payment mismatch'; end if;
 insert into public.webhook_events(provider,event_id) values(payment_provider,payment_event_id) on conflict do nothing;
 get diagnostics inserted=row_count;
 if inserted=0 or purchase.status='paid' then return jsonb_build_object('duplicate',true,'fulfilled',false); end if;
 perform public.allocate_paid_foil(local_order_id);
 update public.orders set status='paid',paid_at=now(),buyer_email=coalesce(nullif(customer_email,''),buyer_email) where id=local_order_id;
 return jsonb_build_object('duplicate',false,'fulfilled',true);
end $$;
-- SQL-language wrappers can bind the old function OID; explicitly replace it.
create or replace function public.fulfill_stripe_checkout_verified(payment_event_id text,checkout_session_id text,local_order_id uuid,paid_amount_cents bigint,paid_currency text,customer_email text default null)
returns jsonb language sql security definer set search_path=public as $$
 select public.fulfill_verified_order('stripe',payment_event_id,checkout_session_id,local_order_id,paid_amount_cents::numeric/100,paid_currency,customer_email);
$$;

create function public.claim_foil_job() returns jsonb language plpgsql security definer set search_path=public as $$
declare m public.mints%rowtype; cfg public.foil_listings%rowtype;
begin
 update public.mints set state='failed',lease_id=null,lease_until=null,last_error='Worker lease expired; studio review required' where state='processing' and lease_until<now() and attempts>=5;
 select * into m from public.mints where (state='queued' and available_at<=now()) or (state='processing' and lease_until<now())
 order by paid_at for update skip locked limit 1;
 if not found then return null; end if;
 update public.mints set state='processing',attempts=attempts+1,lease_id=gen_random_uuid(),lease_until=now()+interval '10 minutes' where id=m.id returning * into m;
 select * into cfg from public.foil_listings where artwork_id=m.listing_id;
 return jsonb_build_object('mint',to_jsonb(m),'listing',to_jsonb(cfg));
end $$;
create function public.finish_foil_job(target_mint uuid,lease uuid,artifact text,file_sha256 text,receipt jsonb,image_width integer,image_height integer)
returns boolean language plpgsql security definer set search_path=public as $$
declare m public.mints%rowtype;
begin
 select * into m from public.mints where id=target_mint for update;
 if not found or m.state<>'processing' or m.lease_id is distinct from lease or m.lease_until<=now() then return false; end if;
 if artifact<>m.owner_id::text||'/'||m.id::text||'/'||lease::text||'.webp' or file_sha256 !~ '^[0-9a-f]{64}$' or receipt->'payload'->>'sha256' is distinct from file_sha256 or receipt->'payload'->>'mintId' is distinct from m.id::text then raise exception 'Invalid artifact receipt'; end if;
 update public.mints set state='ready',artifact_path=artifact,crypto_sha256=file_sha256,manifest=receipt,width=image_width,height=image_height,completed_at=now(),lease_id=null,lease_until=null,last_error=null where id=m.id;
 update public.orders set fulfillment_status='mint_ready' where id=m.order_id;
 return true;
end $$;
create function public.fail_foil_job(target_mint uuid,lease uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 update public.mints set state=case when attempts>=5 then 'failed' else 'queued' end,last_error='Rendering failed; studio review may be required',available_at=now()+interval '2 minutes',lease_id=null,lease_until=null
 where id=target_mint and state='processing' and lease_id=lease;
end $$;
-- Admin retry keeps the already assigned number and rarity.
create function public.retry_foil_job(target_mint uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'Admin required'; end if;
 update public.mints set state='queued',attempts=0,available_at=now(),last_error=null where id=target_mint and state='failed';
end $$;
revoke all on function public.retry_foil_job(uuid) from public;
grant execute on function public.retry_foil_job(uuid) to authenticated;

-- Service-only queue and payment operations.
revoke all on function public.reserve_foil_order(bigint,uuid,text),public.release_foil_order(uuid,text),public.allocate_paid_foil(uuid),public.claim_foil_job(),public.finish_foil_job(uuid,uuid,text,text,jsonb,integer,integer),public.fail_foil_job(uuid,uuid),public.fulfill_verified_order(text,text,text,uuid,numeric,text,text) from public,anon,authenticated;
grant execute on function public.reserve_foil_order(bigint,uuid,text),public.release_foil_order(uuid,text),public.allocate_paid_foil(uuid),public.claim_foil_job(),public.finish_foil_job(uuid,uuid,text,text,jsonb,integer,integer),public.fail_foil_job(uuid,uuid),public.fulfill_verified_order(text,text,text,uuid,numeric,text,text) to service_role;

create function public.admin_foil_settings(target_artwork bigint) returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'Admin required'; end if;
 return (select jsonb_build_object('enabled',enabled,'maxSupply',max_supply,'silverCap',silver_cap,'goldCap',gold_cap,'prismaticCap',prismatic_cap,'totalMinted',total_minted) from public.foil_listings where artwork_id=target_artwork);
end $$;
revoke all on function public.admin_foil_settings(bigint) from public;
grant execute on function public.admin_foil_settings(bigint) to authenticated;

notify pgrst,'reload schema';
commit;
