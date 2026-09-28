-- SECTION: Administrator-only deletion of customer messages
-- Deletion removes the inbox message while leaving orders, customers, and
-- purchase history unchanged.
drop policy if exists "Administrators can delete customer messages"
  on public.contact_messages;

create policy "Administrators can delete customer messages"
  on public.contact_messages for delete to authenticated
  using (
    exists (
      select 1
      from public.admin_users
      where admin_users.user_id = auth.uid()
    )
  );

grant delete on public.contact_messages to authenticated;
