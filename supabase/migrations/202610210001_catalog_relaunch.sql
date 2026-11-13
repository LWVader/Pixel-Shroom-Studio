begin;
-- This migration installs the action only. Applying it never clears the catalog.
create table public.catalog_relaunch_runs (
 id uuid primary key default gen_random_uuid(),
 admin_id uuid not null,
 archived_at timestamptz not null default now(),
 listing_count integer not null,
 previous_listings jsonb not null
);
alter table public.catalog_relaunch_runs enable row level security;
revoke all on public.catalog_relaunch_runs from public,anon,authenticated;
grant select on public.catalog_relaunch_runs to authenticated;
create policy catalog_relaunch_admin_read on public.catalog_relaunch_runs
 for select to authenticated using (public.is_admin());
create function public.archive_catalog_for_relaunch(expected_count integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare total integer; snapshot jsonb; run_id uuid; stamp timestamptz:=now();
begin
 if auth.uid() is null or not coalesce(public.is_admin(),false) then raise exception 'Admin access required'; end if;
 lock table public.foil_listings,public.artworks in share row exclusive mode;
 select count(*)::integer,coalesce(jsonb_agg(jsonb_build_object('artwork',to_jsonb(a),'foil_enabled',f.enabled)),'[]'::jsonb)
 into total,snapshot from public.artworks a left join public.foil_listings f on f.artwork_id=a.id where a.deleted_at is null;
 if expected_count is null or expected_count<>total then raise exception 'Catalog changed. Refresh and review the listing count.'; end if;
 if total=0 then return jsonb_build_object('archived',0); end if;
 insert into public.catalog_relaunch_runs(admin_id,archived_at,listing_count,previous_listings)
 values(auth.uid(),stamp,total,snapshot) returning id into run_id;
 update public.foil_listings set enabled=false where artwork_id in(select id from public.artworks where deleted_at is null);
 update public.artworks set status='archived',deleted_at=stamp,updated_at=stamp where deleted_at is null;
 return jsonb_build_object('archived',total,'runId',run_id);
end $$;
revoke all on function public.archive_catalog_for_relaunch(integer) from public,anon;
grant execute on function public.archive_catalog_for_relaunch(integer) to authenticated;
comment on function public.archive_catalog_for_relaunch(integer) is 'Admin-only soft removal of the current primary artwork catalog; preserves files, orders, mints, receipts, members, and secondary listings. No reset occurs at migration time.';
notify pgrst,'reload schema';
commit;
