# Pixel Shroom Studio · Attention Pack storefront

The storefront sells a $199 USD Attention Pack with five coordinated campaign images. It uses Stripe Checkout for payments, Cloudflare D1 for briefs and delivery status, a Worker password for administrator sign-in, and Gmail for manual ZIP delivery.

## Preview the storefront

From the project folder, run `py -m http.server 8000 --directory public` on Windows. Use `python3` in place of `py` on macOS or Linux. Open http://localhost:8000. The static preview is for the public design. The footer logo opens the admin sign-in page. Use Wrangler’s Worker preview to test signing in or checking out.

## Run site tests

Use Node.js 22.13 or newer. Open PowerShell in the extracted project directory and run:

```powershell
npm.cmd ci
npm.cmd run test:install-browsers
npm.cmd test
```

On macOS and Linux, use `npm` in place of `npm.cmd`. Run `npm run test:api` for browser-free Worker checks or `npm run test:e2e` for Chromium browser checks. On Linux, use `npx playwright install --with-deps chromium` if Chromium needs system libraries.

The suite starts a local test site on port 4173 with an in-memory SQLite database and simulated Stripe Checkout. It checks desktop and mobile navigation, portfolio filtering, footer sign-in, checkout and brief submission, Campaign Admin, the Gmail draft, and AD Studio access. Failed browser tests save traces in `test-results`. Production credentials and deployed infrastructure are unnecessary for these tests.

## Set up Cloudflare

1. Sign in to Wrangler using the Cloudflare account that owns the Worker. In PowerShell run:

   ```powershell
   npm.cmd run wrangler -- login
   npm.cmd run db:info
   ```

   If Cloudflare reports that `pixel-shroom-campaigns` does not exist, create it once with `npm.cmd run db:create`. If it already exists in the correct account, use that database. Wrangler resolves `CAMPAIGN_DB` by its `database_name` in `wrangler.jsonc`. Use `npm` on macOS or Linux. Use a separate database and hostname for staging.
2. Set a unique, randomly generated administrator password of at least 24 characters as the `ADMIN_PASSWORD` Worker secret. Enter it when Wrangler prompts.

   ```powershell
   npm.cmd run wrangler -- secret put ADMIN_PASSWORD
   ```

   The deployment command below applies pending D1 migrations, including the administrator sign-in rate limit. The homepage footer mushroom opens the password form.
3. Connect the same Stripe account used by the earlier storefront. The archived Stripe checkout function reads `STRIPE_SECRET_KEY` from its server environment. The Worker uses that same secret name. If it is already set on this Worker, keep it. If it lived in the old checkout service, set the same authorized key directly in Cloudflare or through Wrangler. Use a test key for staging.

   ```powershell
   npm.cmd run wrangler -- secret put STRIPE_SECRET_KEY
   ```

   Sign in to Campaign Admin and choose **Check Stripe connection** to confirm the API responds and shows the expected test or live mode. An existing one-time $199 USD Stripe Price can be linked with `CAMPAIGN_ATTENTION_PRICE_ID`. Without that setting, the Worker uses the old checkout pattern of creating the line item from the offer price on the server. It verifies the paid Checkout Session before accepting a brief.
4. Run `npm.cmd run deploy` in PowerShell. This applies pending D1 migrations before deploying the Worker to its existing route or domain. For a Git-connected Cloudflare Worker, commit the updated `wrangler.jsonc` and `package.json` to the branch Cloudflare deploys. Set its deploy command to `npm run deploy` and give the build token permission to run D1 migrations, or run `npm.cmd run db:migrate` locally before the Git deployment.

   Verify the public homepage, footer sign-in, a test Stripe purchase and return to the campaign brief, and AD Studio. Set `CAMPAIGN_SITE_URL` if checkout should return to a specific origin. Optionally set `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and `ADMIN_ALERT_EMAIL` for notifications about submitted briefs.

   If Cloudflare reports **10181**, check the config file in the deployment’s working directory and branch. Remove any all-zero database ID for `CAMPAIGN_DB`. If you use a database with a different name, use its actual name and ID in the binding, and run migrations against that binding.

### If you already configured Cloudflare Access

You can continue to use it for admin sign-in. Use one self-hosted Access application to protect `/admin.html`, `/admin-ad-studio/*`, `/api/admin/*`, and `/api/ad-studio/social/*`. Set `ACCESS_TEAM_DOMAIN`, `ACCESS_AUDIENCE`, and `ACCESS_ADMIN_EMAIL` to match that application. Leave `ADMIN_PASSWORD` unset if you only want Access sign-in.

## Previous orders and retirement

This package contains no Supabase runtime, keys, webhook, or legacy Worker fallback. Existing Stripe campaign sessions can still be verified using the same Stripe account. If the earlier campaign system stored briefs, export `campaign_briefs` to CSV, prepare the import locally, and apply it to D1 before directing production traffic here:

```powershell
py tools/prepare-campaign-import.py campaign-briefs.csv campaign-briefs-import.sql
npm.cmd run wrangler -- d1 execute CAMPAIGN_DB --remote --file=campaign-briefs-import.sql
```

These files contain buyer data. Keep them outside the public assets folder and source control. The import preserves previously recorded delivery times and skips sessions already present in D1. Once the new Worker is live and verified, retire the old campaign function and the former campaign-only configuration. Keep any unrelated legacy marketplace project or Stripe webhook active while it still serves historical orders. If that webhook also receives the new campaign sessions, retain its existing guard for the Stripe metadata kind `studio-campaign-v1` so those events do not enter the legacy fulfillment flow.

## Campaign Admin and AD Studio

Click the small mushroom logo in the homepage footer to sign in to Campaign Admin. **Open AD Studio** opens the restored editor, assets, and video export tools under the same administrator sign-in.

For social publishing, reuse the previous Worker’s `AD_STUDIO_DB` binding and `BUFFER_CREDENTIAL_ENCRYPTION_KEY` secret where available. If your saved connection uses an old Supabase administrator UUID, set `AD_STUDIO_LEGACY_USER_ID` to that UUID. Otherwise reconnect Buffer under the new administrator identity. For a fresh setup, create the AD Studio D1 database, add the binding, and apply `migrations/ad-studio.sql` to that database. Store a randomly generated 32-byte key encoded as 64 hex characters in the Worker secret `BUFFER_CREDENTIAL_ENCRYPTION_KEY`. Connect Buffer and, if needed, Cloudinary from AD Studio.

### Track and publish campaigns

From the footer mushroom, sign in to Campaign Admin. The workflow overview shows all orders by stage and the latest activity. Open a brief to move it from New brief to In production or Ready to email. Marking the delivery email as sent moves it to Delivered. For a recurring Monthly Asset Pack, you can move a delivered order back into production for the next delivery.

Use **New campaign** in Campaign publisher to add artwork and a case study. **Save as draft** holds it in admin. **Publish to site** adds it to the public portfolio. **View live** opens its shareable case-study link, and **Unpublish to draft** takes it off the portfolio. The form converts JPG, PNG, or WebP uploads to WebP for the site. The five bundled examples are still available.

### Create ads for the site

Choose **Create ad** on a published campaign to load its artwork, tagline and link into AD Studio. Use **Attention Pack promotion** or **Studio portfolio promotion** when you want a general studio ad. Choose a square, portrait, or story format, edit the copy, and download a PNG or export the video. The **Publish to social** tab uses the existing Buffer connection. Choose **Pop-out editor** to work with the original character and product layouts.

If you're upgrading an existing deployment, apply the pending campaign migrations through `0004_portfolio_industries.sql` before deploying this version. The industry migration preserves existing campaigns. `npm.cmd run deploy` applies the migrations and deploys the Worker. If Git builds still deploy with `npx wrangler deploy`, run `npm.cmd run db:migrate` first.

## Email a finished ZIP

1. Open the buyer’s submitted brief in Campaign Admin. Confirm the matching Stripe invoice for each Monthly Asset Pack delivery.
2. Select **Compose in Gmail**. Verify the From address is `weirichloren@gmail.com`, attach the ZIP, and send it from Gmail. If Gmail opens the inbox, compose a message in that account using the buyer’s email from the order.
3. Select **Mark email sent** after sending. For another ZIP, select **Record another send** after the next email goes out.

Stripe Dashboard shows paid orders from buyers who left before submitting a brief. Follow up with those buyers separately. The checkout return page is used for submitting the brief and offering the optional landing page.

## Optional offers

- Set `CAMPAIGN_LANDING_ENABLED=true` to offer the $199 landing page after the Attention Pack brief is submitted.
- For the $49 Monthly Asset Pack, set `CAMPAIGN_MONTHLY_PRICE_ID` to the active monthly USD Stripe Price and `CAMPAIGN_BILLING_PORTAL_URL` to the Stripe Customer Portal login URL.
