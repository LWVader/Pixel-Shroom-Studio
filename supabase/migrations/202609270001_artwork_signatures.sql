-- SECTION: Public authenticity records
-- Stores only hashes, signatures, and public verification material.
-- Original artwork and private signing keys never belong in this table.
create table if not exists public.artwork_signatures (
  id uuid primary key default gen_random_uuid(),
  artwork_id bigint not null unique references public.artworks(id) on delete cascade,
  serial_number text not null unique,
  creator text not null,
  sha256 text not null unique check (sha256 ~ '^[0-9a-f]{64}$'),
  signature text not null,
  public_key_jwk jsonb not null,
  payload_version integer not null default 1 check (payload_version > 0),
  mime_type text,
  file_size bigint check (file_size is null or file_size >= 0),
  c2pa_embedded boolean not null default false,
  signed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists artwork_signatures_serial_lookup
  on public.artwork_signatures (serial_number);

alter table public.artwork_signatures enable row level security;

-- SECTION: Public verification access
-- These rows contain public keys and signatures, never secrets.
drop policy if exists "Public can verify artwork signatures"
  on public.artwork_signatures;

create policy "Public can verify artwork signatures"
  on public.artwork_signatures
  for select
  to anon, authenticated
  using (true);

-- SECTION: Admin-only write access
drop policy if exists "Administrators can insert artwork signatures"
  on public.artwork_signatures;

create policy "Administrators can insert artwork signatures"
  on public.artwork_signatures
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.admin_users
      where admin_users.user_id = auth.uid()
    )
  );

drop policy if exists "Administrators can update artwork signatures"
  on public.artwork_signatures;

create policy "Administrators can update artwork signatures"
  on public.artwork_signatures
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.admin_users
      where admin_users.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.admin_users
      where admin_users.user_id = auth.uid()
    )
  );

drop policy if exists "Administrators can delete artwork signatures"
  on public.artwork_signatures;

create policy "Administrators can delete artwork signatures"
  on public.artwork_signatures
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.admin_users
      where admin_users.user_id = auth.uid()
    )
  );

grant select on public.artwork_signatures to anon, authenticated;
grant insert, update, delete on public.artwork_signatures to authenticated;

