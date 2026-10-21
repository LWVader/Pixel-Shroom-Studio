begin;
create table public.gelato_products (
 id uuid primary key default gen_random_uuid(), title text not null check(length(title) between 1 and 160),
 kind text not null check(kind in ('canvas','apparel')), variant_label text not null check(length(variant_label) between 1 and 160),
 product_uid text not null check(length(product_uid) between 5 and 500),
 preview_url text not null check(preview_url ~ '^https://'),
 print_path text not null check(print_path ~ '^gelato/'),
 stripe_tax_code text not null check(stripe_tax_code ~ '^txcd_[0-9]{8}$'),
 retail_cents integer not null check(retail_cents between 100 and 1000000),
 active boolean not null default false, print_ready boolean not null default false,
 created_at timestamptz not null default now(), check(not active or print_ready)
);
alter table public.gelato_products enable row level security;
revoke all on public.gelato_products from public,anon,authenticated;
grant all on public.gelato_products to service_role;
create view public.gelato_storefront_products as select id,title,kind,variant_label,preview_url,retail_cents from public.gelato_products where active and print_ready;
revoke all on public.gelato_storefront_products from public;
grant select on public.gelato_storefront_products to anon,authenticated,service_role;
create table public.gelato_quotes (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),
 product_id uuid not null references public.gelato_products(id),product_snapshot jsonb not null,
 quantity integer not null check(quantity between 1 and 10),recipient jsonb not null,
 state text not null default 'quoting' check(state in ('quoting','ready','failed')),
 shipping_options jsonb not null default '[]',test_mode boolean not null,
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '15 minutes'
);
create table public.gelato_orders (
 id uuid primary key default gen_random_uuid(),quote_id uuid not null unique references public.gelato_quotes(id),
 owner_id uuid not null references auth.users(id),product_snapshot jsonb not null,quantity integer not null,
 recipient jsonb not null,shipment_method_uid text not null,shipping_cents integer not null,
 subtotal_cents integer not null,test_mode boolean not null,stripe_session text unique,stripe_payment_intent text,
 payment_state text not null default 'pending' check(payment_state in ('pending','paid','refunded','disputed')),
 fulfillment_state text not null default 'awaiting_payment' check(fulfillment_state in ('awaiting_payment','queued','submitting','accepted','needs_review','canceled')),
 gelato_id text unique,gelato_status text,tracking jsonb not null default '[]',review_reason text,
 created_at timestamptz not null default now(),paid_at timestamptz
);
create table public.gelato_events(event_id text primary key,order_id uuid not null references public.gelato_orders(id),created_at timestamptz not null default now());
create index gelato_quotes_owner_time on public.gelato_quotes(owner_id,created_at);
create index gelato_orders_owner_time on public.gelato_orders(owner_id,created_at);
create index gelato_orders_payment_intent on public.gelato_orders(stripe_payment_intent);
alter table public.gelato_quotes enable row level security;
alter table public.gelato_orders enable row level security;
alter table public.gelato_events enable row level security;
revoke all on public.gelato_quotes,public.gelato_orders,public.gelato_events from public,anon,authenticated;
grant all on public.gelato_quotes,public.gelato_orders,public.gelato_events to service_role;
create function public.limit_gelato_quotes() returns trigger language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text,21));
 if (select count(*) from public.gelato_quotes where owner_id=new.owner_id and created_at>now()-interval '1 minute')>=10 then raise exception 'Too many quote requests. Try again shortly.'; end if;
 return new;
end $$;
create trigger gelato_quote_rate_limit before insert on public.gelato_quotes for each row execute function public.limit_gelato_quotes();
create function public.reserve_gelato_checkout(target_quote uuid,buyer uuid,shipping_method text) returns jsonb language plpgsql security definer set search_path=public as $$
declare q public.gelato_quotes; o public.gelato_orders; option jsonb;
begin
 select * into q from public.gelato_quotes where id=target_quote and owner_id=buyer for update;
 if not found then raise exception 'Quote not found'; end if;
 select * into o from public.gelato_orders where quote_id=q.id;
 if found then
  if o.shipment_method_uid<>shipping_method then raise exception 'Start a fresh quote to change shipping'; end if;
  return to_jsonb(o);
 end if;
 if q.state<>'ready' or q.expires_at<=now() then raise exception 'Quote expired. Request a new quote.'; end if;
 if not exists(select 1 from public.gelato_products where id=q.product_id and active and print_ready) then raise exception 'Product unavailable'; end if;
 select value into option from jsonb_array_elements(q.shipping_options) where value->>'uid'=shipping_method;
 if option is null then raise exception 'Invalid shipping option'; end if;
 insert into public.gelato_orders(quote_id,owner_id,product_snapshot,quantity,recipient,shipment_method_uid,shipping_cents,subtotal_cents,test_mode)
 values(q.id,buyer,q.product_snapshot,q.quantity,q.recipient,shipping_method,(option->>'cents')::int,(q.product_snapshot->>'retail_cents')::int*q.quantity+(option->>'cents')::int,q.test_mode) returning * into o;
 return to_jsonb(o);
end $$;
create function public.claim_gelato_payment(target_order uuid,session_id text,event_key text,subtotal integer,currency_code text,is_live boolean,intent text) returns void language plpgsql security definer set search_path=public as $$
declare o public.gelato_orders;
begin
 select * into o from public.gelato_orders where id=target_order for update;
 if not found or o.stripe_session is distinct from session_id or o.subtotal_cents is distinct from subtotal or currency_code<>'usd' or o.test_mode=is_live then raise exception 'Print payment mismatch'; end if;
 insert into public.gelato_events(event_id,order_id) values(event_key,o.id) on conflict do nothing;
 if o.payment_state='pending' then update public.gelato_orders set payment_state='paid',paid_at=now(),stripe_payment_intent=intent,fulfillment_state='queued' where id=o.id; end if;
end $$;
create function public.claim_gelato_submission(target_order uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare o public.gelato_orders;
begin
 update public.gelato_orders set fulfillment_state='submitting' where id=target_order and payment_state='paid' and fulfillment_state='queued' returning * into o;
 if not found then return null; end if;
 return to_jsonb(o);
end $$;
revoke all on function public.limit_gelato_quotes(),public.reserve_gelato_checkout(uuid,uuid,text),public.claim_gelato_payment(uuid,text,text,integer,text,boolean,text),public.claim_gelato_submission(uuid) from public,anon,authenticated;
grant execute on function public.reserve_gelato_checkout(uuid,uuid,text),public.claim_gelato_payment(uuid,text,text,integer,text,boolean,text),public.claim_gelato_submission(uuid) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('gelato-print-files','gelato-print-files',false,104857600,array['image/png','image/jpeg','application/pdf']) on conflict(id) do nothing;
-- Sources are immutable uploads. New product revisions upload new paths; old paid snapshots keep their files.
create policy gelato_print_admin_insert on storage.objects for insert to authenticated with check(bucket_id='gelato-print-files' and public.is_admin());
create policy gelato_print_admin_read on storage.objects for select to authenticated using(bucket_id='gelato-print-files' and public.is_admin());
notify pgrst,'reload schema';
commit;
