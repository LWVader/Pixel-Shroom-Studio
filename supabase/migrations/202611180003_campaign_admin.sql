create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid())
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

grant select on public.campaign_briefs, public.campaign_zip_deliveries to authenticated;

drop policy if exists "admins read campaign briefs" on public.campaign_briefs;
create policy "admins read campaign briefs" on public.campaign_briefs
  for select to authenticated using ((select public.is_admin()));

drop policy if exists "admins read campaign deliveries" on public.campaign_zip_deliveries;
create policy "admins read campaign deliveries" on public.campaign_zip_deliveries
  for select to authenticated using ((select public.is_admin()));

drop policy if exists "admins upload campaign ZIPs" on storage.objects;
create policy "admins upload campaign ZIPs" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'campaign-zips' and (select public.is_admin())
    and name ~ '^[a-f0-9]{64}/[A-Za-z0-9][A-Za-z0-9._-]{0,115}[.]zip$'
  );

create or replace function public.publish_campaign_zip_as_admin(order_session text, zip_path text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  return public.publish_campaign_zip(order_session, zip_path);
end;
$$;

create or replace function public.withdraw_campaign_zip_as_admin(order_session text, delivery_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  delete from public.campaign_zip_deliveries
  where checkout_session_id = order_session and id = delivery_id;
  return found;
end;
$$;

revoke all on function public.publish_campaign_zip_as_admin(text, text) from public, anon;
revoke all on function public.withdraw_campaign_zip_as_admin(text, uuid) from public, anon;
grant execute on function public.publish_campaign_zip_as_admin(text, text) to authenticated;
grant execute on function public.withdraw_campaign_zip_as_admin(text, uuid) to authenticated;
