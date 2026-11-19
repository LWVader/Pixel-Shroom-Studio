# Pixel Shroom Studio · Attention Pack storefront

This redesign uses the existing Pixel Shroom Studio domain, mushroom mark, Stripe account and Supabase project. The homepage sells one $199 USD pack of five coordinated surreal campaign images. Five fictional campaigns demonstrate the approach. Each case has a brief, art direction, color palette and a social placement example.

## Preview the site

Run this from the extracted project folder using Python 3.

```powershell
py -m http.server 8000 --directory public
```

Open http://localhost:8000. On macOS or Linux use `python3` in place of `py`. This preview shows the artwork and portfolio interactions. Use a Cloudflare Worker and the Supabase function for checkout.

## Connect test checkout

Use staging or your existing test project before moving the production route. Confirm which Git revision Cloudflare currently runs. The legacy archive records the source revision used to make this package.

1. In the existing Supabase project, apply both files in `supabase/migrations` in order. They create the private campaign tables, `campaign-zips` Storage bucket, and administrator access policies. If the brief and ZIP migrations are already deployed, apply only `202611180003_campaign_admin.sql`. The earlier catalog and order tables need no changes.
2. Copy `supabase/functions/campaign-orders` into the existing Supabase source and merge the new function entry from `supabase/config.toml` into the existing config. Deploy it with JWT verification off. It uses a shared server-only key instead. The package includes the webhook patch and its shared dependencies for comparison. Apply the new `studio-campaign-v1` guard to the version of the legacy Stripe webhook running in your project before using the same Stripe account. Preserve later edits to that webhook.
3. Set the same randomly generated `CAMPAIGN_PROXY_KEY` of at least 32 characters as a Cloudflare Worker secret and a Supabase function secret. Keep it out of Git, browser code and the command line. Set `CAMPAIGN_SITE_URL` in Supabase to the actual staging Worker origin during tests and `https://www.pixelshroomstudio.com` for the production cutover. Set `CAMPAIGN_SUPABASE_URL` in the Worker config if you use a separate staging project.
4. Use the existing `STRIPE_SECRET_KEY` in Supabase. For staging, use a Stripe test key and set `CAMPAIGN_ATTENTION_ENABLED=true` when the function and migration are in place. Deploy to the staging Worker with Wrangler and test checkout, cancellation, payment return, brief submission, studio notification, and a ZIP download from the correct paid order. Use the existing `RESEND_API_KEY`, `RESEND_FROM_EMAIL` and optionally `ADMIN_ALERT_EMAIL` for notification.
5. For a full production switch, deploy with the existing Cloudflare Worker name and the current custom-domain routing. The new campaign admin and AD Studio are served by this Worker. Other archived storefront and Vault URLs return a help page in a standalone deployment. If existing orders or verification links still need those routes, deploy the previous source as a separate Worker with its current bindings and set a service binding named `LEGACY_STUDIO` on the redesign. Requests for URLs absent from the redesign then reach the earlier Worker. Check early order links and admin login before moving the production route. Keep the prior Cloudflare deployment available for rollback.

## Fulfill orders

The buyer pays with Stripe and submits a brief from the private order page. View submitted briefs in the Supabase `campaign_briefs` table. Stripe Dashboard shows paid sessions for buyers who left before submitting a brief. Follow up separately for missing briefs.

## Campaign Admin and AD Studio

Open `/admin.html` and sign in with the same Supabase administrator email and password used by the old site. The dashboard uses the existing `admin_users` membership table. On a new Supabase project, create the owner account under Authentication and insert its user UUID into `public.admin_users` through the SQL Editor. On a separate staging project, set the Worker vars `CAMPAIGN_SUPABASE_URL` and `CAMPAIGN_SUPABASE_PUBLIC_KEY` to that project’s URL and publishable or anon key. Keep service-role credentials server-side.

Select **Open AD Studio** to use the restored editor, including its project files, assets, animations and video export. The editor is also available at `/admin-ad-studio/` after admin sign-in.

### Connect AD Studio social publishing

If social publishing was configured on the previous Worker, add its existing D1 binding under the name `AD_STUDIO_DB` and reuse its `BUFFER_CREDENTIAL_ENCRYPTION_KEY` Worker secret so the saved connections and history stay readable. The Worker entry point for this package is `worker.mjs`.

For a first-time setup, create an AD Studio D1 database, add the `AD_STUDIO_DB` binding in Wrangler, and apply `migrations/ad-studio.sql` to that D1 database. Set `BUFFER_CREDENTIAL_ENCRYPTION_KEY` as a Worker secret using a randomly generated 32-byte key encoded as 64 hexadecimal characters. In the editor’s **Publish to social** tab, connect Buffer and optionally Cloudinary for video hosting. Campaign briefs and ZIP delivery use Supabase and work independently of D1.

### Publish a finished ZIP

1. In Campaign Admin, open the buyer’s brief. For each recurring Monthly Asset Pack delivery, confirm the matching month’s invoice in Stripe.
2. Select the finished ZIP and choose **Publish ZIP to order**. Use a name like `Orbit-Roast-Campaign.zip` and keep it at or below 50 MiB. Your Supabase project may enforce a lower upload limit.
3. Choose **Copy buyer’s private order link** and send it to the buyer’s checkout email. The buyer can also reopen the original order page. Treat the order link as private because it grants access to that order.

Publishing the same ZIP with the same filename to the same order is safe to retry. Give each monthly drop a distinct name. The order page lists each ZIP, newest first, and issues a two-minute download URL when the buyer clicks it. **Withdraw** removes a ZIP from the order page and stops new download links. Previously issued links can still work until they expire. Remove the Storage object in Supabase if you also need to delete the uploaded file.

### Upload from the command line

Use the buyer’s `checkout_session_id` from the private Supabase `campaign_briefs` table. In a private local environment file saved outside the project, set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and, for staging, `CAMPAIGN_SITE_URL`. Use the project’s server secret or legacy service-role key. Run this command from the extracted project on Node.js 22 or later.

```powershell
node --env-file="C:\path\to\campaign-publish.env" tools/publish-campaign-zip.mjs cs_test_yourCheckoutSessionId "C:\path\to\Orbit-Roast-Campaign.zip"
```

The command prints the private order link after publishing. Send it manually to the buyer’s checkout email.

## Enable add-ons when ready

- Set `CAMPAIGN_LANDING_ENABLED=true` to offer the $199 one-page landing page after an Attention Pack buyer submits the brief. That checkout is tied to the original order. A buyer returning from an expired add-on checkout is directed to email the studio.
- Create a Stripe Product and active $49 USD per month flat recurring Price for the Monthly Asset Pack. Enable the Stripe Customer Portal with subscription cancellation. Set `CAMPAIGN_MONTHLY_PRICE_ID` and `CAMPAIGN_BILLING_PORTAL_URL` to the Price ID and the Stripe-hosted portal login link. The homepage shows the subscription when configured. Review recurring payments in Stripe before scheduling each month's ten backgrounds.

The optional offers are off unless enabled. The studio prepares and publishes finished ZIPs by hand. The buyer downloads them from the order page.
