-- Forge & Print: additive ledger, prepared-copy upgrades and private print claims.
begin;
alter table public.mints add column forge_consumed_at timestamptz;
alter table public.gelato_products add column edition_artwork_id bigint references public.foil_listings(artwork_id);
alter table public.gelato_products add column edition_tier text check(edition_tier in ('Standard','Silver','Gold','Emerald','Sapphire','Prismatic'));
alter table public.gelato_products add constraint edition_mapping_pair check((edition_artwork_id is null)=(edition_tier is null));
create unique index gelato_edition_mapping on public.gelato_products(edition_artwork_id,edition_tier) where edition_artwork_id is not null;
alter table public.foil_tier_assets add column preview_path text;
create function public.set_foil_tier_preview(target bigint,chosen_tier text,preview text) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_admin() or preview !~ ('^foil-tiers/'||target::text||'/'||lower(chosen_tier)||'/[0-9a-f-]{36}\.webp$') or not exists(select 1 from storage.objects where bucket_id='previews' and name=preview) then raise exception 'Protected tier preview required'; end if;
 update public.foil_tier_assets set preview_path=preview where listing_id=target and tier=chosen_tier;
 if not found then raise exception 'Upload the tier image first'; end if;
end $$;
revoke all on function public.set_foil_tier_preview(bigint,text,text) from public,anon;
grant execute on function public.set_foil_tier_preview(bigint,text,text) to authenticated;
create or replace view public.gelato_storefront_products as select id,title,kind,variant_label,preview_url,retail_cents from public.gelato_products where active and print_ready and edition_artwork_id is null;
create table public.forge_print_purchases (
 order_id uuid primary key references public.orders(id), offer text not null check(offer in ('digital','canvas')),
 test_mode boolean not null, stripe_payment_intent text, created_at timestamptz not null default now()
);
create table public.canvas_claims (
 mint_id uuid primary key references public.mints(id), owner_id uuid not null references auth.users(id),
 state text not null default 'available' check(state in ('available','redeemed','held')),
 gelato_order_id uuid unique references public.gelato_orders(id), created_at timestamptz not null default now()
);
create table public.forge_operations (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),
 request_id uuid not null,listing_id bigint not null references public.foil_listings(artwork_id),
 from_tier text not null,to_tier text not null,output_mint_id uuid unique references public.mints(id),
 created_at timestamptz not null default now(),unique(owner_id,request_id)
);
create table public.forge_inputs (
 mint_id uuid primary key references public.mints(id),operation_id uuid not null references public.forge_operations(id)
);
alter table public.gelato_quotes add column edition_mint_id uuid references public.mints(id);
alter table public.gelato_orders add column edition_mint_id uuid references public.mints(id);
create index gelato_edition_orders on public.gelato_orders(edition_mint_id);
-- Private by default. Every operation checks the authenticated owner in the Edge function.
alter table public.forge_print_purchases enable row level security;
alter table public.canvas_claims enable row level security;
alter table public.forge_operations enable row level security;
alter table public.forge_inputs enable row level security;
revoke all on public.forge_print_purchases,public.canvas_claims,public.forge_operations,public.forge_inputs from public,anon,authenticated;
grant all on public.forge_print_purchases,public.canvas_claims,public.forge_operations,public.forge_inputs to service_role;

create function public.reserve_forge_print_order(target_artwork bigint,buyer uuid,token_hash text,chosen_offer text,is_test boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 if (select count(*) from public.foil_tier_assets where listing_id=target_artwork and preview_path is not null)<>6 then raise exception 'Six protected tier previews are required'; end if;
 if chosen_offer not in ('digital','canvas') then raise exception 'Unknown offer'; end if;
 if chosen_offer='canvas' and (select count(distinct p.edition_tier) from public.gelato_products p where p.edition_artwork_id=target_artwork and p.kind='canvas' and p.active and p.print_ready)<>6 then raise exception 'All six approved print mappings are required'; end if;
 result:=public.reserve_foil_order(target_artwork,buyer,token_hash);
 update public.orders set amount=case when chosen_offer='digital' then 8 else 82.49 end where id=(result->>'orderId')::uuid;
 insert into public.forge_print_purchases(order_id,offer,test_mode) values((result->>'orderId')::uuid,chosen_offer,is_test);
 return result||jsonb_build_object('price',case when chosen_offer='digital' then 8 else 82.49 end,'offer',chosen_offer);
end $$;

-- Keep an advertised canvas format/source stable while checkout or a claim is outstanding.
create function public.protect_reserved_canvas_mapping() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if old.edition_artwork_id is null then return new; end if;
 perform 1 from public.foil_listings where artwork_id=old.edition_artwork_id for update;
 if row(new.product_uid,new.print_path,new.edition_artwork_id,new.edition_tier,new.kind,new.active,new.print_ready,new.variant_label,new.preview_url)
 is distinct from row(old.product_uid,old.print_path,old.edition_artwork_id,old.edition_tier,old.kind,old.active,old.print_ready,old.variant_label,old.preview_url)
 and exists(select 1 from public.forge_print_purchases p join public.orders o on o.id=p.order_id join public.mints m on m.order_id=o.id left join public.canvas_claims c on c.mint_id=m.id
 where p.offer='canvas' and o.artwork_id=old.edition_artwork_id and (o.status='pending' or (o.status='paid' and c.state='available' and m.tier=old.edition_tier)))
 then raise exception 'Mapping is reserved by an outstanding canvas checkout or claim'; end if;
 return new;
end $$;
create trigger protect_reserved_canvas_mapping before update on public.gelato_products for each row execute function public.protect_reserved_canvas_mapping();
revoke all on function public.protect_reserved_canvas_mapping() from public,anon,authenticated;
create function public.record_canvas_claim() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status='paid' and old.status is distinct from 'paid' and exists(select 1 from public.forge_print_purchases where order_id=new.id and offer='canvas') then
  insert into public.canvas_claims(mint_id,owner_id) select id,owner_id from public.mints where order_id=new.id on conflict do nothing;
 end if;
 if new.status in ('refunded','failed') then
  update public.canvas_claims set state='held' where mint_id in(select id from public.mints where order_id=new.id) and state='available';
 end if;
 return new;
end $$;
create trigger record_paid_canvas_claim after update of status on public.orders for each row execute function public.record_canvas_claim();
-- Saving is durable and automatic. The reveal and optional downloads do not control ownership.
create function public.auto_save_ready_edition() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.state='ready' and new.forge_consumed_at is null then new.collection_added_at:=coalesce(new.collection_added_at,now()); end if;
 return new;
end $$;
create trigger save_ready_edition before insert or update of state on public.mints for each row execute function public.auto_save_ready_edition();
update public.mints m set collection_added_at=coalesce(collection_added_at,now()) where state='ready' and exists(select 1 from public.orders o where o.id=m.order_id and o.status='paid');

create function public.forge_edition(holder uuid,input_ids uuid[],operation_key uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare first_m public.mints; m public.mints; cfg public.foil_listings; op public.forge_operations;
 required integer; target_tier text; cap integer; purchase uuid; output_id uuid; n integer; v_listing bigint;
begin
 if holder is null or operation_key is null or cardinality(input_ids) not between 2 and 5 or cardinality(input_ids)<>(select count(distinct x) from unnest(input_ids) x) then raise exception 'Choose distinct eligible editions'; end if;
 -- Stable owner/request lock: retries return the same output even after the inputs are consumed.
 perform pg_advisory_xact_lock(hashtextextended(holder::text||operation_key::text,22));
 select * into op from public.forge_operations where owner_id=holder and request_id=operation_key;
 if found then return jsonb_build_object('mintId',op.output_mint_id,'tier',op.to_tier,'replayed',true); end if;
 select listing_id into v_listing from public.mints where id=input_ids[1];
 select * into cfg from public.foil_listings where artwork_id=v_listing for update;
 if not found then raise exception 'Artwork unavailable'; end if;
 select * into first_m from public.mints where id=input_ids[1];
 required:=case first_m.tier when 'Standard' then 5 when 'Silver' then 3 when 'Gold' then 3 when 'Emerald' then 2 when 'Sapphire' then 2 else 0 end;
 target_tier:=case first_m.tier when 'Standard' then 'Silver' when 'Silver' then 'Gold' when 'Gold' then 'Emerald' when 'Emerald' then 'Sapphire' when 'Sapphire' then 'Prismatic' end;
 if required=0 or cardinality(input_ids)<>required then raise exception 'Incorrect recipe quantity'; end if;
 for m in select * from public.mints where id=any(input_ids) order by id for update loop
  if m.owner_id is distinct from holder or m.listing_id<>v_listing or m.tier<>first_m.tier or m.state<>'ready' or m.market_frozen or m.forge_consumed_at is not null or m.asset_mode<>'inventory'
   or not exists(select 1 from public.orders where id=m.order_id and status='paid')
   or exists(select 1 from public.canvas_claims where mint_id=m.id)
   or exists(select 1 from public.secondary_market where mint_id=m.id and status in ('preparing','active','reserved','frozen'))
   or exists(select 1 from public.gelato_orders where edition_mint_id=m.id and fulfillment_state<>'canceled')
  then raise exception 'An input is unavailable, printed, listed or holds a canvas claim'; end if;
 end loop;
 if (select count(*) from public.mints where id=any(input_ids))<>required then raise exception 'Missing input'; end if;
 cap:=case target_tier when 'Silver' then cfg.silver_cap when 'Gold' then cfg.gold_cap when 'Emerald' then cfg.emerald_cap when 'Sapphire' then cfg.sapphire_cap when 'Prismatic' then cfg.prismatic_cap end;
 if cfg.total_minted+(select count(*) from public.mints where listing_id=v_listing and state='reserved')>=cfg.max_supply
 or (select count(*) from public.mints where listing_id=v_listing and tier=target_tier)>=cap
 or not exists(select 1 from public.foil_copy_inventory where listing_id=v_listing and tier=target_tier and state='ready') then raise exception 'No authorized upgrade inventory remains'; end if;
 -- Output is an authorized new numbered copy, never a recycled or newly generated image.
 insert into public.orders(artwork_id,provider,status,amount,currency,access_token_hash,sale_kind,paid_at,fulfillment_status)
 values(v_listing,'stripe','paid',0,'usd',repeat('0',64),'foil',now(),'mint_queued') returning id into purchase;
 insert into public.mints(listing_id,order_id,owner_id) values(v_listing,purchase,holder) returning id into output_id;
 n:=cfg.total_minted+1;
 update public.foil_listings set total_minted=n where artwork_id=v_listing;
 update public.mints set state='queued',tier=target_tier,mint_number=n,paid_at=now(),available_at=now() where id=output_id;
 insert into public.forge_operations(owner_id,request_id,listing_id,from_tier,to_tier,output_mint_id)
 values(holder,operation_key,v_listing,first_m.tier,target_tier,output_id) returning * into op;
 insert into public.forge_inputs select x,op.id from unnest(input_ids) x;
 update public.mints set forge_consumed_at=now(),market_frozen=true,ownership_version=ownership_version+1 where id=any(input_ids);
 return jsonb_build_object('mintId',output_id,'tier',target_tier,'replayed',false);
end $$;

-- Quote creation is not a reservation. Ownership is rechecked under a row lock at checkout.
create function public.lock_edition_print() returns trigger language plpgsql security definer set search_path=public as $$
declare m public.mints; q public.gelato_quotes; p public.gelato_products;
begin
 select * into q from public.gelato_quotes where id=new.quote_id;
 if q.edition_mint_id is null then return new; end if;
 select * into m from public.mints where id=q.edition_mint_id for update;
 select * into p from public.gelato_products where id=q.product_id;
 if m.owner_id is distinct from new.owner_id or m.state<>'ready' or m.market_frozen or m.forge_consumed_at is not null
 or not exists(select 1 from public.orders where id=m.order_id and status='paid')
 or p.edition_artwork_id is distinct from m.listing_id or p.edition_tier is distinct from m.tier
 or exists(select 1 from public.secondary_market where mint_id=m.id and status in ('preparing','active','reserved','frozen')) then raise exception 'Edition unavailable for printing'; end if;
 new.edition_mint_id:=m.id;
 return new;
end $$;
create trigger lock_edition_print before insert on public.gelato_orders for each row execute function public.lock_edition_print();
create function public.protect_printed_edition() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if (new.owner_id is distinct from old.owner_id or new.forge_consumed_at is distinct from old.forge_consumed_at) and exists(select 1 from public.gelato_orders where edition_mint_id=old.id and fulfillment_state<>'canceled') then raise exception 'Edition is attached to a print order'; end if;
 if new.owner_id is distinct from old.owner_id and exists(select 1 from public.canvas_claims where mint_id=old.id) then raise exception 'Canvas claim editions cannot transfer'; end if;
 return new;
end $$;
create trigger protect_printed_edition before update on public.mints for each row execute function public.protect_printed_edition();
create function public.protect_canvas_market_listing() returns trigger language plpgsql security definer set search_path=public as $$
begin
 perform 1 from public.mints where id=new.mint_id for update;
 if exists(select 1 from public.canvas_claims where mint_id=new.mint_id) or exists(select 1 from public.gelato_orders where edition_mint_id=new.mint_id and fulfillment_state<>'canceled') then raise exception 'Canvas claim or print-order editions cannot be listed'; end if;
 return new;
end $$;
create trigger protect_canvas_market_listing before insert on public.secondary_market for each row execute function public.protect_canvas_market_listing();
revoke all on function public.protect_canvas_market_listing() from public,anon,authenticated;
create function public.redeem_canvas_claim(target_order uuid,holder uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare o public.gelato_orders; m public.mints; claim public.canvas_claims; purchase public.forge_print_purchases;
begin
 select * into o from public.gelato_orders where id=target_order and owner_id=holder for update;
 if not found or o.edition_mint_id is null then raise exception 'Invalid canvas order'; end if;
 select * into m from public.mints where id=o.edition_mint_id for update;
 select * into claim from public.canvas_claims where mint_id=m.id for update;
 select * into purchase from public.forge_print_purchases where order_id=m.order_id;
 if claim.gelato_order_id=o.id and claim.state='redeemed' then return to_jsonb(o); end if;
 if m.owner_id is distinct from holder or m.market_frozen or claim.owner_id is distinct from holder or claim.state is distinct from 'available'
 or purchase.test_mode is distinct from o.test_mode or not exists(select 1 from public.orders where id=m.order_id and status='paid')
 or o.subtotal_cents<>0 or o.product_snapshot->>'claimMintId' is distinct from m.id::text then raise exception 'Canvas claim unavailable'; end if;
 update public.canvas_claims set state='redeemed',gelato_order_id=o.id where mint_id=m.id;
 update public.gelato_orders set payment_state='paid',fulfillment_state='queued',paid_at=now() where id=o.id returning * into o;
 return to_jsonb(o);
end $$;
-- A reversal freezes the purchased edition and all derived Forge outputs for review.
create function public.hold_forge_print_purchase(target_order uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 with recursive family(id) as (
 select id from public.mints where order_id=target_order
 union select op.output_mint_id from family f join public.forge_inputs i on i.mint_id=f.id join public.forge_operations op on op.id=i.operation_id
 ) update public.mints set market_frozen=true where id in(select id from family);
 update public.canvas_claims set state='held' where mint_id in(select id from public.mints where market_frozen);
 update public.gelato_orders set fulfillment_state='needs_review',review_reason='Original edition payment reversed; studio review required.' where edition_mint_id in(select id from public.mints where market_frozen) and fulfillment_state<>'canceled';
end $$;
revoke all on function public.hold_forge_print_purchase(uuid) from public,anon,authenticated;
grant execute on function public.hold_forge_print_purchase(uuid) to service_role;
revoke all on function public.reserve_forge_print_order(bigint,uuid,text,text,boolean),public.forge_edition(uuid,uuid[],uuid),public.redeem_canvas_claim(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_forge_print_order(bigint,uuid,text,text,boolean),public.forge_edition(uuid,uuid[],uuid),public.redeem_canvas_claim(uuid,uuid) to service_role;
revoke all on function public.record_canvas_claim(),public.auto_save_ready_edition(),public.lock_edition_print(),public.protect_printed_edition() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
