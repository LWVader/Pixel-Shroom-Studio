begin;
-- Shipping defaults are private account data, separate from immutable order snapshots.
create table public.vault_profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 recipient jsonb,
 updated_at timestamptz not null default now(),
 constraint valid_vault_recipient check(recipient is null or (
   jsonb_typeof(recipient)='object' and recipient->>'country'='US'
   and length(recipient->>'firstName') between 1 and 25
   and length(recipient->>'lastName') between 1 and 25
   and length(recipient->>'addressLine1') between 1 and 35
   and length(coalesce(recipient->>'addressLine2',''))<=35
   and length(recipient->>'city') between 1 and 30
   and recipient->>'state' ~ '^[A-Z]{2}$'
   and recipient->>'postCode' ~ '^[0-9]{5}(-[0-9]{4})?$'
   and length(coalesce(recipient->>'phone',''))<=25
 ) is true)
);
alter table public.vault_profiles enable row level security;
revoke all on public.vault_profiles from public,anon,authenticated;
grant select,insert,update,delete on public.vault_profiles to authenticated;
create policy own_vault_profile on public.vault_profiles for all to authenticated
 using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
commit;
