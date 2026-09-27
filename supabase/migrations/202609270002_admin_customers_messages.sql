-- SECTION: Customer messages stored for the administrator inbox
create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  email text not null check (char_length(email) between 3 and 254),
  subject text not null check (char_length(subject) between 1 and 160),
  message text not null check (char_length(message) between 10 and 5000),
  is_read boolean not null default false,
  alert_sent_at timestamptz,
  alert_error text,
  created_at timestamptz not null default now()
);

create index if not exists contact_messages_created_at_idx
  on public.contact_messages (created_at desc);

alter table public.contact_messages enable row level security;

-- Public submissions pass through the submit-message Edge Function.
-- Browsers receive no direct insert policy for this table.
drop policy if exists "Administrators can read customer messages"
  on public.contact_messages;
create policy "Administrators can read customer messages"
  on public.contact_messages for select to authenticated
  using (exists (
    select 1 from public.admin_users
    where admin_users.user_id = auth.uid()
  ));

drop policy if exists "Administrators can update customer messages"
  on public.contact_messages;
create policy "Administrators can update customer messages"
  on public.contact_messages for update to authenticated
  using (exists (
    select 1 from public.admin_users
    where admin_users.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.admin_users
    where admin_users.user_id = auth.uid()
  ));

grant select, update on public.contact_messages to authenticated;

