begin;
-- Keep earlier paid claims and their mappings unchanged; corrected products use version 3.
alter table public.gelato_products drop constraint gelato_products_canvas_version_check;
alter table public.gelato_products add constraint gelato_products_canvas_version_check check(canvas_version in(1,2,3));
alter table public.forge_print_purchases drop constraint forge_print_purchases_canvas_version_check;
alter table public.forge_print_purchases add constraint forge_print_purchases_canvas_version_check check(canvas_version in(1,2,3));
alter table public.gelato_products add constraint canvas_v3_format check(canvas_version<>3 or edition_artwork_id is null or (
 (kind='canvas' and case when edition_tier in('Standard','Silver','Gold') then frame_finish='none' and print_specs->>'width'='16' and print_specs->>'height'='16'
 when edition_tier in('Emerald','Sapphire') then frame_finish<>'none' and print_specs->>'width'='16' and print_specs->>'height'='24'
 when edition_tier='Prismatic' then frame_finish<>'none' and print_specs->>'width'='24' and print_specs->>'height'='24' else false end) is true));
create or replace function public.canvas_options_ready(target_artwork bigint) returns boolean language sql stable security definer set search_path=public as $$
 select count(*)=12 from public.gelato_products p where edition_artwork_id=target_artwork and canvas_version=3 and active and print_ready and kind='canvas' and
 ((edition_tier in('Standard','Silver','Gold') and frame_finish='none') or (edition_tier in('Emerald','Sapphire','Prismatic') and frame_finish in('black','natural','dark-wood')))
$$;
create or replace function public.canvas_version_for_mint(target_mint uuid) returns smallint language sql stable security definer set search_path=public as $$
 select coalesce((select p.canvas_version from public.canvas_claims c join public.mints m on m.id=c.mint_id join public.forge_print_purchases p on p.order_id=m.order_id where c.mint_id=target_mint),3)::smallint
$$;
revoke all on function public.canvas_options_ready(bigint),public.canvas_version_for_mint(uuid) from public,anon,authenticated;
grant execute on function public.canvas_options_ready(bigint),public.canvas_version_for_mint(uuid) to service_role;
create or replace function public.reserve_forge_print_order(target_artwork bigint,buyer uuid,token_hash text,chosen_offer text,is_test boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 perform 1 from public.foil_listings where artwork_id=target_artwork for update;
 if (select count(*) from public.foil_tier_assets where listing_id=target_artwork and preview_path is not null)<>6 then raise exception 'Six protected tier previews are required'; end if;
 if chosen_offer not in ('digital','canvas') then raise exception 'Unknown offer'; end if;
 if chosen_offer='canvas' and (select count(distinct p.edition_tier) from public.gelato_products p where p.edition_artwork_id=target_artwork and p.kind='canvas' and p.active and p.print_ready)<>6 then raise exception 'All six approved print mappings are required'; end if;
 if chosen_offer='canvas' and not public.canvas_options_ready(target_artwork) then raise exception 'Load all 12 current canvas/frame mappings before opening canvas rolls'; end if;
 result:=public.reserve_foil_order(target_artwork,buyer,token_hash);
 update public.orders set amount=case when chosen_offer='digital' then 8 else 82.49 end where id=(result->>'orderId')::uuid;
 insert into public.forge_print_purchases(order_id,offer,test_mode,canvas_version) values((result->>'orderId')::uuid,chosen_offer,is_test,3);
 return result||jsonb_build_object('price',case when chosen_offer='digital' then 8 else 82.49 end,'offer',chosen_offer);
end $$;
create or replace function public.protect_reserved_canvas_mapping() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if old.edition_artwork_id is null then return new; end if;
 perform 1 from public.foil_listings where artwork_id=old.edition_artwork_id for update;
 if row(new.product_uid,new.print_path,new.edition_artwork_id,new.edition_tier,new.kind,new.active,new.print_ready,new.variant_label,new.preview_url,new.frame_finish,new.canvas_version)
 is distinct from row(old.product_uid,old.print_path,old.edition_artwork_id,old.edition_tier,old.kind,old.active,old.print_ready,old.variant_label,old.preview_url,old.frame_finish,old.canvas_version)
 and exists(select 1 from public.forge_print_purchases p join public.orders o on o.id=p.order_id join public.mints m on m.order_id=o.id left join public.canvas_claims c on c.mint_id=m.id
 where p.offer='canvas' and o.artwork_id=old.edition_artwork_id and (o.status='pending' or (o.status='paid' and c.state='available' and m.tier=old.edition_tier)))
 then raise exception 'Mapping is reserved by an outstanding canvas checkout or claim'; end if;
 return new;
end $$;
create or replace function public.lock_edition_print() returns trigger language plpgsql security definer set search_path=public as $$
declare m public.mints; q public.gelato_quotes; p public.gelato_products;
begin
 select * into q from public.gelato_quotes where id=new.quote_id;
 if q.edition_mint_id is null then return new; end if;
 select * into m from public.mints where id=q.edition_mint_id for update;
 select * into p from public.gelato_products where id=q.product_id;
 if m.owner_id is distinct from new.owner_id or m.state<>'ready' or m.market_frozen or m.forge_consumed_at is not null
 or not exists(select 1 from public.orders where id=m.order_id and status='paid')
 or p.edition_artwork_id is distinct from m.listing_id or p.edition_tier is distinct from m.tier
 or p.canvas_version is distinct from public.canvas_version_for_mint(m.id)
 or exists(select 1 from public.secondary_market where mint_id=m.id and status in ('preparing','active','reserved','frozen')) then raise exception 'Edition unavailable for printing'; end if;
 new.edition_mint_id:=m.id;
 return new;
end $$;
create or replace view public.gelato_storefront_products as select id,title,kind,variant_label,preview_url,retail_cents from public.gelato_products where active and print_ready and edition_artwork_id is null and canvas_version=3;
commit;
