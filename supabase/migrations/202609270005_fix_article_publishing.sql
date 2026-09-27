-- SECTION: Align editorial permissions with the current administrator table
-- The dashboard authenticates administrators through public.admin_users.
-- These policies deliberately use that same source of truth.
alter table public.articles enable row level security;

drop policy if exists "published articles are public"
  on public.articles;
create policy "published articles are public"
  on public.articles for select
  using (
    status = 'published'
    or exists (
      select 1
      from public.admin_users
      where admin_users.user_id = auth.uid()
    )
  );

drop policy if exists "admin manages articles"
  on public.articles;
create policy "admin manages articles"
  on public.articles for all to authenticated
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

grant select on public.articles to anon, authenticated;
grant insert, update, delete on public.articles to authenticated;
grant usage, select on sequence public.articles_id_seq to authenticated;
