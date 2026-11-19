alter table public.campaign_briefs
  add column if not exists email_delivered_at timestamptz;

create or replace function public.record_campaign_email_sent(
  order_session text,
  previous_delivery timestamptz
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  sent_at timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  update public.campaign_briefs
  set email_delivered_at = clock_timestamp()
  where checkout_session_id = order_session
    and email_delivered_at is not distinct from previous_delivery
  returning email_delivered_at into sent_at;

  if not found then
    select email_delivered_at into sent_at
    from public.campaign_briefs
    where checkout_session_id = order_session;
    if not found then
      raise exception 'Campaign brief was not found for this checkout session';
    end if;
  end if;

  return sent_at;
end;
$$;

revoke all on function public.record_campaign_email_sent(text, timestamptz) from public, anon;
grant execute on function public.record_campaign_email_sent(text, timestamptz) to authenticated;

drop policy if exists "admins upload campaign ZIPs" on storage.objects;
drop policy if exists "admins read campaign deliveries" on public.campaign_zip_deliveries;
revoke select on public.campaign_zip_deliveries from authenticated;
revoke execute on function public.publish_campaign_zip_as_admin(text, text) from authenticated;
revoke execute on function public.withdraw_campaign_zip_as_admin(text, uuid) from authenticated;
revoke execute on function public.publish_campaign_zip(text, text) from service_role;
