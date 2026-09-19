# Pixel Shroom Studio — static site + Supabase

This edition removes Express, SQLite, local private files, Sharp, and the always-on Node server. The `public/` folder is a static Cloudflare Pages site. Supabase provides Postgres, Auth, public preview storage, private original storage, Row Level Security, checkout functions, verified webhooks, and short-lived download URLs.

## Architecture

- Static frontend: `public/`
- Database and security policies: `supabase/migrations/202609180001_artvault.sql`
- Private files: Supabase Storage bucket `originals`
- Public watermarked previews: bucket `previews`
- Server-only payment logic: `supabase/functions/`
- Stripe and PayPal secrets exist only as Edge Function secrets

The public Supabase URL and anon key are intentionally used by the browser. The service-role key, payment keys, webhook secrets, and original files must never be committed or placed in `public/`.

## 1. Create and configure Supabase

1. Create a Supabase project and install the Supabase CLI.
2. From this project folder, run `supabase link --project-ref YOUR_PROJECT_REF`.
3. Run `supabase db push` to create the tables, RLS policies, and Storage buckets.
4. In Supabase Authentication, create the owner account with the email you want to use.
5. In SQL Editor, add that account as the sole administrator:

```sql
insert into public.admin_users (user_id)
select id from auth.users where email = 'YOUR_ADMIN_EMAIL';
```

6. Copy `public/config.example.js` to `public/config.js`, then enter the project URL and public anon key.

## 2. Configure secrets and deploy functions

Set secrets (do not use the literal placeholders):

```bash
supabase secrets set SITE_URL=https://YOUR-DOMAIN.example
supabase secrets set STRIPE_SECRET_KEY=sk_test_REPLACE_ME
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_REPLACE_ME
supabase secrets set PAYPAL_ENV=sandbox
supabase secrets set PAYPAL_CLIENT_ID=REPLACE_ME
supabase secrets set PAYPAL_CLIENT_SECRET=REPLACE_ME
supabase secrets set PAYPAL_WEBHOOK_ID=REPLACE_ME
supabase functions deploy
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are automatically available to hosted Supabase Edge Functions.

## 3. Configure verified webhooks

Stripe endpoint:

`https://YOUR_PROJECT_REF.supabase.co/functions/v1/stripe-webhook`

Subscribe to `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Put its signing secret in `STRIPE_WEBHOOK_SECRET`.

PayPal endpoint:

`https://YOUR_PROJECT_REF.supabase.co/functions/v1/paypal-webhook`

Subscribe to `PAYMENT.CAPTURE.COMPLETED`, then store the webhook ID in `PAYPAL_WEBHOOK_ID`. Start with PayPal sandbox values.

The checkout return page never marks an order paid. Only a successfully verified provider webhook changes `orders.status` to `paid` and creates a download license.

## 4. Deploy the static site to Cloudflare Pages

Connect the GitHub repository to Cloudflare Pages and use:

- Framework preset: None
- Build command: leave empty
- Build output directory: `public`
- Root directory: repository root

The included `_headers` adds security headers and `_redirects` keeps old `/genre/fantasy`-style links working. After changing the production domain, update the `SITE_URL` Edge Function secret and the allowed redirect URLs in Supabase Authentication.

## Admin workflow

Open `/admin.html` and sign in with the Supabase Auth owner account. Upload a reduced-resolution preview with the watermark permanently baked into its pixels. Upload the clean original separately; it goes to the private `originals` bucket and has no public URL. NFT ZIP packages remain manual-email fulfillment.

## Local preview

Run `npm run dev`, then use the URL printed by the static server. Payment callbacks still require publicly reachable provider webhooks; use the provider CLIs or deploy the Edge Functions for end-to-end testing.

## Security notes

- RLS permits anonymous users to read only published artwork and articles.
- Only UUIDs listed in `admin_users` can manage catalog records, orders, and Storage uploads.
- Prices are read from Postgres inside `create-checkout`; browser-supplied prices are ignored.
- Originals are accessed only by the service-role Edge Function after paid-order and token checks.
- Generated download URLs expire after five minutes. Licenses expire after 24 hours and allow three issued links.
- Public previews must already contain a pixel-level watermark; CSS overlays are not treated as protection.
