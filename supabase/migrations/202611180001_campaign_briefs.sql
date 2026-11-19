create table if not exists public.campaign_briefs (
  checkout_session_id text primary key,
  offer text not null check (offer in ('attention', 'monthly')),
  buyer_email text not null,
  business text not null,
  industry text not null,
  vibe text not null,
  colors text not null,
  goal text not null,
  landing_session_id text unique,
  landing_paid_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.campaign_briefs enable row level security;
revoke all on table public.campaign_briefs from public, anon, authenticated;
grant select, insert, update on table public.campaign_briefs to service_role;
