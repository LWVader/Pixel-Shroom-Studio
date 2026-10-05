-- Required by the uploaded master webhook and download functions.
-- Apply after the existing migrations. No tables or existing orders are deleted.
begin;

create or replace function public.fulfill_verified_order(
  payment_provider text,
  payment_event_id text,
  provider_reference text,
  local_order_id uuid,
  paid_amount numeric,
  paid_currency text,
  customer_email text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  purchase public.orders%rowtype;
  artwork_category text;
  inserted_event integer;
begin
  if payment_provider not in ('stripe') or
     coalesce(payment_event_id, '') = '' or coalesce(provider_reference, '') = '' then
    raise exception 'Invalid payment event';
  end if;
  select * into purchase from public.orders
    where id = local_order_id and provider = payment_provider
    for update;
  if not found then raise exception 'Order not found'; end if;
  if purchase.provider_order_id is distinct from provider_reference or
     purchase.amount is distinct from paid_amount or
     lower(purchase.currency) is distinct from lower(paid_currency) then
    raise exception 'Payment does not match the pending order';
  end if;
  if purchase.status not in ('pending', 'paid') then
    raise exception 'Order cannot be fulfilled';
  end if;
  insert into public.webhook_events(provider, event_id)
    values(payment_provider, payment_event_id) on conflict do nothing;
  get diagnostics inserted_event = row_count;
  if inserted_event = 0 then
    return jsonb_build_object('duplicate', true, 'fulfilled', false);
  end if;
  if purchase.status = 'paid' then
    return jsonb_build_object('duplicate', false, 'fulfilled', false, 'alreadyPaid', true);
  end if;
  select category into artwork_category from public.artworks where id = purchase.artwork_id;
  if not found then raise exception 'Artwork not found'; end if;
  update public.orders set
    status = 'paid', paid_at = now(),
    buyer_email = coalesce(nullif(customer_email, ''), buyer_email),
    fulfillment_status = case when artwork_category = 'NFT' then 'email_pending' else 'ready' end
    where id = purchase.id;
  if artwork_category <> 'NFT' then
    insert into public.licenses(order_id, expires_at, download_limit)
      values(purchase.id, now() + interval '24 hours', 3)
      on conflict(order_id) do nothing;
  end if;
  return jsonb_build_object('duplicate', false, 'fulfilled', true);
end;
$$;

create or replace function public.fulfill_stripe_checkout_verified(
  payment_event_id text,
  checkout_session_id text,
  local_order_id uuid,
  paid_amount_cents bigint,
  paid_currency text,
  customer_email text default null
) returns jsonb
language sql security definer set search_path = public
as $$
  select public.fulfill_verified_order(
    'stripe', payment_event_id, checkout_session_id, local_order_id,
    paid_amount_cents::numeric / 100, paid_currency, customer_email
  );
$$;

create or replace function public.consume_verified_download(target_order uuid)
returns boolean language plpgsql security definer set search_path = public
as $$
declare consumed uuid;
begin
  update public.licenses as license
    set download_count = license.download_count + 1
    where license.order_id = target_order
      and license.expires_at > now()
      and license.download_count < license.download_limit
      and exists (
        select 1 from public.orders as purchase
        join public.artworks as artwork on artwork.id = purchase.artwork_id
        where purchase.id = target_order and purchase.status = 'paid'
          and artwork.category <> 'NFT'
      )
    returning license.id into consumed;
  return consumed is not null;
end;
$$;

revoke all on function public.fulfill_verified_order(text,text,text,uuid,numeric,text,text) from public, anon, authenticated;
revoke all on function public.fulfill_stripe_checkout_verified(text,text,uuid,bigint,text,text) from public, anon, authenticated;
revoke all on function public.consume_verified_download(uuid) from public, anon, authenticated;
grant execute on function public.fulfill_verified_order(text,text,text,uuid,numeric,text,text) to service_role;
grant execute on function public.fulfill_stripe_checkout_verified(text,text,uuid,bigint,text,text) to service_role;
grant execute on function public.consume_verified_download(uuid) to service_role;
commit;
