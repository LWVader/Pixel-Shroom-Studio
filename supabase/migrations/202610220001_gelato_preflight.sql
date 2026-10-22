-- Private admin evidence only: public product view remains unchanged.
alter table public.gelato_products
  add column if not exists print_specs jsonb,
  add column if not exists preflight_report jsonb;
notify pgrst, 'reload schema';
