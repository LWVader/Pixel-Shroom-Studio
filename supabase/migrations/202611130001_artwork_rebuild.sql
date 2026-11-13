begin;

-- Install the reset controls without deleting anything during deployment.
create function public.preview_artwork_rebuild()
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or not coalesce(public.is_admin(),false) then
  raise exception 'Admin access required';
 end if;
 return (
  select coalesce(jsonb_agg(jsonb_build_object(
   'id',a.id,'serial',a.serial_number,'title',a.title,
   'protected',
    exists(select 1 from public.orders o where o.artwork_id=a.id)
    or exists(select 1 from public.mints m where m.listing_id=a.id)
    or exists(select 1 from public.forge_operations f where f.listing_id=a.id)
    or exists(select 1 from public.gelato_products p join public.gelato_quotes q on q.product_id=p.id where p.edition_artwork_id=a.id)
  ) order by a.id),'[]'::jsonb) from public.artworks a
 );
end $$;

create function public.delete_unlinked_artworks_for_rebuild(expected_ids bigint[])
returns integer language plpgsql security definer set search_path=public set lock_timeout='5s' as $$
declare eligible bigint[]; removed integer;
begin
 if auth.uid() is null or not coalesce(public.is_admin(),false) then
  raise exception 'Admin access required';
 end if;
 lock table public.foil_listings, public.artworks, public.orders,
  public.mints, public.forge_operations, public.gelato_products, public.gelato_quotes
  in share row exclusive mode;
 select coalesce(array_agg((r->>'id')::bigint order by (r->>'id')::bigint),'{}'::bigint[])
 into eligible from jsonb_array_elements(public.preview_artwork_rebuild()) r
 where not (r->>'protected')::boolean;
 if expected_ids is distinct from eligible then
  raise exception 'Artwork or transaction records changed. Preview the reset again.';
 end if;
 delete from public.gelato_products where edition_artwork_id=any(eligible);
 delete from public.foil_copy_inventory where listing_id=any(eligible);
 delete from public.foil_tier_assets where listing_id=any(eligible);
 delete from public.foil_listings where artwork_id=any(eligible);
 -- The artwork FK cascades to the unlinked public signature row.
 delete from public.artworks where id=any(eligible);
 get diagnostics removed=row_count;
 return removed;
end $$;

-- Bind Standard to the exact signed original and protected preview already
-- stored for the parent artwork. No second upload or client-supplied hash.
create function public.set_standard_tier_from_master(target_artwork bigint, preview text)
returns void language plpgsql security definer set search_path=public as $$
declare cfg public.foil_listings%rowtype; art public.artworks%rowtype;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Admin access required'; end if;
 select * into strict cfg from public.foil_listings where artwork_id=target_artwork for update;
 select * into strict art from public.artworks where id=target_artwork;
 if exists(select 1 from public.mints where listing_id=target_artwork) then
  raise exception 'Tier images are locked after first reservation';
 end if;
 if preview is null or preview !~ '^artworks/[a-f0-9-]{36}-protected-preview\.webp$'
  or right(art.preview_url,length(preview)+1) is distinct from '/'||preview
  or not exists(select 1 from storage.objects where bucket_id='previews' and name=preview)
  or cfg.master_path is distinct from art.original_path
  or not exists(select 1 from storage.objects where bucket_id='originals' and name=cfg.master_path)
  or art.original_format not in ('image/png','image/jpeg','image/webp')
  or art.original_width is null or art.original_height is null then
  raise exception 'The signed Standard image and its protected preview are required';
 end if;
 insert into public.foil_tier_assets(listing_id,tier,path,sha256,mime_type,width,height,preview_path)
 values(target_artwork,'Standard',cfg.master_path,cfg.master_sha256,art.original_format,
  art.original_width,art.original_height,preview)
 on conflict(listing_id,tier) do update set path=excluded.path,sha256=excluded.sha256,
  mime_type=excluded.mime_type,width=excluded.width,height=excluded.height,preview_path=excluded.preview_path;
end $$;

revoke all on function public.preview_artwork_rebuild(),
 public.delete_unlinked_artworks_for_rebuild(bigint[]),
 public.set_standard_tier_from_master(bigint,text) from public,anon;
grant execute on function public.preview_artwork_rebuild(),
 public.delete_unlinked_artworks_for_rebuild(bigint[]),
 public.set_standard_tier_from_master(bigint,text) to authenticated;
notify pgrst,'reload schema';
commit;
