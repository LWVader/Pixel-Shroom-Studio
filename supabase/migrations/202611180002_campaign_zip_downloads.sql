insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('campaign-zips', 'campaign-zips', false, 52428800, array['application/zip'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.campaign_zip_deliveries (
  id uuid primary key default gen_random_uuid(),
  checkout_session_id text not null references public.campaign_briefs (checkout_session_id),
  object_path text not null unique
    check (object_path ~ '^[a-f0-9]{64}/[A-Za-z0-9][A-Za-z0-9._-]{0,115}[.]zip$'),
  file_name text generated always as (split_part(object_path, '/', 2)) stored,
  published_at timestamptz not null default now()
);

create index if not exists campaign_zip_deliveries_order_date
  on public.campaign_zip_deliveries (checkout_session_id, published_at desc, id);

alter table public.campaign_zip_deliveries enable row level security;
revoke all on table public.campaign_zip_deliveries from public, anon, authenticated;
grant select, delete on table public.campaign_zip_deliveries to service_role;

create or replace function public.publish_campaign_zip(order_session text, zip_path text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery_id uuid;
begin
  if zip_path is null or zip_path !~ '^[a-f0-9]{64}/[A-Za-z0-9][A-Za-z0-9._-]{0,115}[.]zip$' then
    raise exception 'Invalid campaign ZIP path';
  end if;
  if not exists (
    select 1 from public.campaign_briefs where checkout_session_id = order_session
  ) then
    raise exception 'Campaign brief was not found for this checkout session';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'campaign-zips'
      and name = zip_path
      and metadata ->> 'mimetype' = 'application/zip'
  ) then
    raise exception 'Upload the ZIP to the private campaign-zips bucket before publishing';
  end if;

  insert into public.campaign_zip_deliveries (checkout_session_id, object_path)
  values (order_session, zip_path)
  on conflict (object_path) do nothing
  returning id into delivery_id;

  if delivery_id is null then
    select id into delivery_id
    from public.campaign_zip_deliveries
    where object_path = zip_path and checkout_session_id = order_session;
    if delivery_id is null then
      raise exception 'That ZIP is already assigned to another campaign order';
    end if;
  end if;
  return delivery_id;
end;
$$;

revoke all on function public.publish_campaign_zip(text, text) from public, anon, authenticated;
grant execute on function public.publish_campaign_zip(text, text) to service_role;
