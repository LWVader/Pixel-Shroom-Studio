begin;
alter table public.mints add column ownership_version integer not null default 0 check(ownership_version>=0);
alter table public.mints add column market_frozen boolean not null default false;
create table public.market_sellers(
 user_id uuid primary key references auth.users(id),stripe_account_id text unique,
 provision_id uuid not null default gen_random_uuid(),charges_enabled boolean not null default false,
 payouts_enabled boolean not null default false,transfers_enabled boolean not null default false,checked_at timestamptz
);
create table public.secondary_market(
 id uuid primary key default gen_random_uuid(),mint_id uuid not null references public.mints(id),seller_id uuid not null references auth.users(id),
 seller_version integer not null,price_cents integer not null check(price_cents between 100 and 99999999),
 status text not null default 'preparing' check(status in ('preparing','active','reserved','sold','cancelled','frozen')),
 preview_path text,created_at timestamptz not null default now(),sold_at timestamptz
);
create unique index one_open_market_listing on public.secondary_market(mint_id) where status in ('preparing','active','reserved','frozen');
create table public.market_purchases(
 id uuid primary key default gen_random_uuid(),listing_id uuid not null references public.secondary_market(id),buyer_id uuid not null references auth.users(id),
 price_cents integer not null,fee_cents integer not null,destination_account text not null,currency text not null default 'usd' check(currency='usd'),
 state text not null default 'pending' check(state in ('pending','succeeded','cancelled','refund_pending','refunded','review')),
 checkout_session_id text unique,payment_intent_id text unique,refund_id text,transfer_version integer,
 last_error text,created_at timestamptz not null default now(),paid_at timestamptz,checked_at timestamptz
);
create unique index one_pending_market_checkout on public.market_purchases(listing_id) where state='pending';
create table public.market_transfers(
 id uuid primary key default gen_random_uuid(),purchase_id uuid not null references public.market_purchases(id),mint_id uuid not null references public.mints(id),
 from_owner uuid not null references auth.users(id),to_owner uuid not null references auth.users(id),ownership_version integer not null,
 reason text not null check(reason in ('sale','refund')),created_at timestamptz not null default now(),unique(purchase_id,reason)
);
create table public.market_events(event_id text primary key,event_type text not null,created_at timestamptz not null default now());
create table public.market_preview_jobs(
 listing_id uuid primary key references public.secondary_market(id),state text not null default 'queued' check(state in ('queued','processing','ready','failed')),
 attempts integer not null default 0,lease_id uuid,lease_until timestamptz,available_at timestamptz not null default now()
);
create index market_purchase_recovery on public.market_purchases(state,checked_at);
create index market_feed on public.secondary_market(status,created_at desc);
alter table public.market_sellers enable row level security;
alter table public.secondary_market enable row level security;
alter table public.market_purchases enable row level security;
alter table public.market_transfers enable row level security;
alter table public.market_events enable row level security;
alter table public.market_preview_jobs enable row level security;
revoke all on public.market_sellers,public.secondary_market,public.market_purchases,public.market_transfers,public.market_events,public.market_preview_jobs from anon,authenticated;
grant all on public.market_sellers,public.secondary_market,public.market_purchases,public.market_transfers,public.market_events,public.market_preview_jobs to service_role;

create function public.create_market_listing(target_mint uuid,seller uuid,cents integer) returns uuid
language plpgsql security definer set search_path=public as $$
declare m public.mints%rowtype; offer uuid;
begin
 select * into m from public.mints where id=target_mint for update;
 if not found or m.owner_id is distinct from seller or m.state<>'ready' or m.market_frozen or not exists(select 1 from public.orders where id=m.order_id and status='paid') then raise exception 'Edition unavailable for resale'; end if;
 if not exists(select 1 from public.market_sellers where user_id=seller and charges_enabled and payouts_enabled and transfers_enabled and stripe_account_id is not null) then raise exception 'Complete seller onboarding'; end if;
 insert into public.secondary_market(mint_id,seller_id,seller_version,price_cents) values(m.id,seller,m.ownership_version,cents) returning id into offer;
 insert into public.market_preview_jobs(listing_id) values(offer);
 return offer;
end $$;
create function public.cancel_market_listing(target_listing uuid,seller uuid) returns void
language plpgsql security definer set search_path=public as $$
declare offer public.secondary_market%rowtype;
begin
 select * into offer from public.secondary_market where id=target_listing;
 if not found then raise exception 'Listing not found'; end if;
 perform 1 from public.mints where id=offer.mint_id for update;
 select * into offer from public.secondary_market where id=target_listing for update;
 if offer.seller_id is distinct from seller or offer.status not in ('active','preparing') then raise exception 'Only unreserved owned listings can be cancelled'; end if;
 update public.secondary_market set status='cancelled' where id=offer.id;
end $$;
create function public.reserve_market_checkout(target_listing uuid,buyer uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare offer public.secondary_market%rowtype;m public.mints%rowtype;account text;purchase uuid;
begin
 select * into offer from public.secondary_market where id=target_listing;
 if not found then raise exception 'Listing unavailable'; end if;
 select * into m from public.mints where id=offer.mint_id for update;
 select * into offer from public.secondary_market where id=target_listing for update;
 if buyer is null or buyer=offer.seller_id or offer.status<>'active' or m.owner_id is distinct from offer.seller_id or m.ownership_version<>offer.seller_version or m.market_frozen or m.state<>'ready' or not exists(select 1 from public.orders where id=m.order_id and status='paid') then raise exception 'Listing unavailable'; end if;
 select stripe_account_id into account from public.market_sellers where user_id=offer.seller_id and charges_enabled and payouts_enabled and transfers_enabled;
 if not found then raise exception 'Seller unavailable'; end if;
 insert into public.market_purchases(listing_id,buyer_id,price_cents,fee_cents,destination_account)
 values(offer.id,buyer,offer.price_cents,round(offer.price_cents*0.10)::integer,account) returning id into purchase;
 update public.secondary_market set status='reserved' where id=offer.id;
 return jsonb_build_object('purchaseId',purchase,'priceCents',offer.price_cents,'feeCents',round(offer.price_cents*0.10)::integer,'destination',account,'tier',m.tier,'mintNumber',m.mint_number);
end $$;
create function public.expire_market_checkout(target_purchase uuid,session_id text) returns void
language plpgsql security definer set search_path=public as $$
declare p public.market_purchases%rowtype;o public.secondary_market%rowtype;m public.mints%rowtype;
begin
 select * into p from public.market_purchases where id=target_purchase;
 if not found then return; end if;
 select * into o from public.secondary_market where id=p.listing_id;
 select * into m from public.mints where id=o.mint_id for update;
 select * into o from public.secondary_market where id=p.listing_id for update;
 select * into p from public.market_purchases where id=target_purchase for update;
 if p.state<>'pending' or p.checkout_session_id is distinct from session_id then return; end if;
 update public.market_purchases set state='cancelled',checked_at=now() where id=p.id;
 update public.secondary_market set status=case when m.owner_id=o.seller_id and m.ownership_version=o.seller_version and not m.market_frozen then 'active' else 'cancelled' end where id=o.id and status='reserved';
end $$;
create function public.finalize_market_sale(target_purchase uuid,session_id text,payment_id text,event_id text,paid_cents integer,paid_currency text,fee integer,destination text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare p public.market_purchases%rowtype;o public.secondary_market%rowtype;m public.mints%rowtype;
begin
 select * into p from public.market_purchases where id=target_purchase;
 if not found then raise exception 'Purchase not found'; end if;
 select * into o from public.secondary_market where id=p.listing_id;
 select * into m from public.mints where id=o.mint_id for update;
 select * into o from public.secondary_market where id=p.listing_id for update;
 select * into p from public.market_purchases where id=target_purchase for update;
 if p.checkout_session_id is distinct from session_id or paid_cents is distinct from p.price_cents or paid_currency is distinct from p.currency or fee is distinct from p.fee_cents or destination is distinct from p.destination_account or coalesce(payment_id,'')='' or coalesce(event_id,'')='' then raise exception 'Payment does not match reserved purchase'; end if;
 if p.payment_intent_id is not null and p.payment_intent_id<>payment_id then raise exception 'Payment reference mismatch'; end if;
 if p.state in ('succeeded','refunded','review') then return jsonb_build_object('duplicate',true); end if;
 if p.state='refund_pending' then return jsonb_build_object('refundRequired',true); end if;
 insert into public.market_events(event_id,event_type) values(event_id,'paid') on conflict do nothing;
 if p.state<>'pending' or o.status<>'reserved' or m.owner_id is distinct from o.seller_id or m.ownership_version<>o.seller_version or m.market_frozen or m.state<>'ready' or not exists(select 1 from public.orders where id=m.order_id and status='paid') then
  update public.market_purchases set state='refund_pending',payment_intent_id=payment_id,last_error='Paid transfer could not be completed',checked_at=now() where id=p.id;
  update public.secondary_market set status='cancelled' where id=o.id and status='reserved' and not exists(select 1 from public.market_purchases other where other.listing_id=o.id and other.state='pending' and other.id<>p.id);
  return jsonb_build_object('refundRequired',true);
 end if;
 update public.mints set owner_id=p.buyer_id,ownership_version=ownership_version+1 where id=m.id;
 -- Revoke the original checkout-return secret permanently after the first transfer.
 update public.orders set access_token_hash=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','') where id=m.order_id;
 update public.secondary_market set status='sold',sold_at=now() where id=o.id;
 update public.market_purchases set state='succeeded',payment_intent_id=payment_id,paid_at=now(),transfer_version=m.ownership_version+1,checked_at=now() where id=p.id;
 insert into public.market_transfers(purchase_id,mint_id,from_owner,to_owner,ownership_version,reason) values(p.id,m.id,o.seller_id,p.buyer_id,m.ownership_version+1,'sale');
 return jsonb_build_object('transferred',true);
end $$;

-- Full refunds undo the transfer only while the same buyer/version still holds
-- it. Later resale chains and partial refunds freeze for review, never silently
-- seize another buyer's edition.
create function public.market_payment_problem(target_purchase uuid,event_id text,problem text,full_refund boolean default false) returns void
language plpgsql security definer set search_path=public as $$
declare p public.market_purchases%rowtype;o public.secondary_market%rowtype;m public.mints%rowtype;
begin
 select * into p from public.market_purchases where id=target_purchase;
 if not found then return; end if;
 select * into o from public.secondary_market where id=p.listing_id;
 select * into m from public.mints where id=o.mint_id for update;
 select * into o from public.secondary_market where id=p.listing_id for update;
 select * into p from public.market_purchases where id=target_purchase for update;
 if exists(select 1 from public.market_events e where e.event_id=market_payment_problem.event_id) then return; end if;
 insert into public.market_events(event_id,event_type) values(event_id,problem);
 if p.state='refunded' then return; end if;
 if full_refund and p.transfer_version is null then update public.market_purchases set state='refunded',checked_at=now() where id=p.id;return; end if;
 update public.mints set market_frozen=true where id=m.id;
 update public.secondary_market set status='frozen' where mint_id=m.id and status in ('active','preparing','reserved');
 if full_refund and m.owner_id=p.buyer_id and m.ownership_version=p.transfer_version and not exists(select 1 from public.market_purchases other_p join public.secondary_market other_o on other_o.id=other_p.listing_id where other_o.mint_id=m.id and other_p.id<>p.id and other_p.state in ('review','refund_pending')) then
  update public.mints set owner_id=o.seller_id,ownership_version=ownership_version+1,market_frozen=false where id=m.id;
  update public.secondary_market set status='cancelled' where mint_id=m.id and status='frozen';
  insert into public.market_transfers(purchase_id,mint_id,from_owner,to_owner,ownership_version,reason) values(p.id,m.id,p.buyer_id,o.seller_id,m.ownership_version+1,'refund') on conflict do nothing;
  update public.market_purchases set state='refunded',checked_at=now() where id=p.id;
 else
  update public.market_purchases set state='review',last_error=problem,checked_at=now() where id=p.id;
 end if;
end $$;
create function public.prepare_market_refund(target_purchase uuid) returns void
language plpgsql security definer set search_path=public as $$
declare p public.market_purchases%rowtype;o public.secondary_market%rowtype;
begin
 select * into p from public.market_purchases where id=target_purchase;
 if not found or p.state not in ('succeeded','refund_pending') then raise exception 'Purchase cannot be refunded automatically'; end if;
 select * into o from public.secondary_market where id=p.listing_id;
 perform 1 from public.mints where id=o.mint_id for update;
 perform 1 from public.secondary_market where id=o.id for update;
 select * into p from public.market_purchases where id=target_purchase for update;
 if p.state not in ('succeeded','refund_pending') then raise exception 'Purchase cannot be refunded'; end if;
 update public.mints set market_frozen=true where id=o.mint_id;
 update public.secondary_market set status='frozen' where mint_id=o.mint_id and status in ('active','preparing','reserved');
 update public.market_purchases set state='refund_pending',checked_at=now() where id=p.id;
end $$;

create function public.claim_market_preview() returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.market_preview_jobs%rowtype;o public.secondary_market%rowtype;m public.mints%rowtype;
begin
 update public.market_preview_jobs set state='failed' where state='processing' and lease_until<now() and attempts>=5;
 select * into j from public.market_preview_jobs where (state='queued' and available_at<=now()) or (state='processing' and lease_until<now()) order by available_at for update skip locked limit 1;
 if not found then return null; end if;
 update public.market_preview_jobs set state='processing',attempts=attempts+1,lease_id=gen_random_uuid(),lease_until=now()+interval '5 minutes' where listing_id=j.listing_id returning * into j;
 select * into o from public.secondary_market where id=j.listing_id;
 select * into m from public.mints where id=o.mint_id;
 return jsonb_build_object('listingId',o.id,'leaseId',j.lease_id,'artifactPath',m.artifact_path,'sha256',m.crypto_sha256,'mintNumber',m.mint_number,'tier',m.tier);
end $$;
create function public.finish_market_preview(target_listing uuid,lease uuid,path text) returns boolean language plpgsql security definer set search_path=public as $$
declare o public.secondary_market%rowtype;m public.mints%rowtype;j public.market_preview_jobs%rowtype;
begin
 select * into o from public.secondary_market where id=target_listing;
 if not found then return false; end if;
 select * into m from public.mints where id=o.mint_id for update;
 select * into o from public.secondary_market where id=target_listing for update;
 select * into j from public.market_preview_jobs where listing_id=target_listing for update;
 if j.state<>'processing' or j.lease_id is distinct from lease or j.lease_until<=now() or path<>'secondary/'||o.id::text||'/'||lease::text||'.webp' then return false; end if;
 update public.market_preview_jobs set state='ready',lease_until=null where listing_id=o.id;
 if o.status<>'preparing' or m.owner_id is distinct from o.seller_id or m.ownership_version<>o.seller_version or m.market_frozen then return false; end if;
 update public.secondary_market set preview_path=path,status='active' where id=o.id;
 return true;
end $$;
create function public.fail_market_preview(target_listing uuid,lease uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 update public.market_preview_jobs set state=case when attempts>=5 then 'failed' else 'queued' end,available_at=now()+interval '2 minutes',lease_until=null where listing_id=target_listing and state='processing' and lease_id=lease;
end $$;
create function public.market_feed(search_term text default '',tier_filter text default '',page_offset integer default 0) returns jsonb
language sql security definer set search_path=public as $$
 select coalesce(jsonb_agg(to_jsonb(feed)),'[]'::jsonb) from (
  select o.id,o.price_cents,o.preview_path,m.id as mint_id,m.tier,m.mint_number,f.max_supply,f.master_title as title,f.master_serial as serial
  from public.secondary_market o join public.mints m on m.id=o.mint_id join public.foil_listings f on f.artwork_id=m.listing_id join public.market_sellers s on s.user_id=o.seller_id join public.orders p on p.id=m.order_id
  where o.status='active' and m.state='ready' and not m.market_frozen and m.owner_id=o.seller_id and m.ownership_version=o.seller_version and p.status='paid' and s.charges_enabled and s.payouts_enabled and s.transfers_enabled
  and (tier_filter='' or m.tier=tier_filter) and (search_term='' or (f.master_title||' '||f.master_serial) ilike '%'||left(search_term,120)||'%')
  order by o.created_at desc,o.id desc limit 25 offset greatest(0,least(page_offset,100000))
 )feed;
$$;
-- No client chooses buyer IDs, destinations or finalization parameters.
revoke all on function public.create_market_listing(uuid,uuid,integer),public.cancel_market_listing(uuid,uuid),public.reserve_market_checkout(uuid,uuid),public.expire_market_checkout(uuid,text),public.finalize_market_sale(uuid,text,text,text,integer,text,integer,text),public.market_payment_problem(uuid,text,text,boolean),public.prepare_market_refund(uuid),public.claim_market_preview(),public.finish_market_preview(uuid,uuid,text),public.fail_market_preview(uuid,uuid),public.market_feed(text,text,integer) from public,anon,authenticated;
grant execute on function public.create_market_listing(uuid,uuid,integer),public.cancel_market_listing(uuid,uuid),public.reserve_market_checkout(uuid,uuid),public.expire_market_checkout(uuid,text),public.finalize_market_sale(uuid,text,text,text,integer,text,integer,text),public.market_payment_problem(uuid,text,text,boolean),public.prepare_market_refund(uuid),public.claim_market_preview(),public.finish_market_preview(uuid,uuid,text),public.fail_market_preview(uuid,uuid),public.market_feed(text,text,integer) to service_role;
notify pgrst,'reload schema';
commit;
