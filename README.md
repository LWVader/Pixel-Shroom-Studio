# Pixel Shroom Studio · Attention Pack storefront

The storefront sells a $79 USD Attention Pack with five coordinated campaign images. It uses Stripe Checkout for payments, Cloudflare D1 for briefs and delivery status, a Worker password for administrator sign-in, and Gmail for manual ZIP delivery.

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

   Sign in to Campaign Admin and choose **Check Stripe connection** to confirm the API responds and shows the expected test or live mode. An existing active one-time $79 USD Stripe Price can be linked with `CAMPAIGN_ATTENTION_PRICE_ID`. If the setting is absent or still references the previous one-time $199 USD Price, the Worker creates the line item at the server-owned $79 price instead. It verifies paid Checkout Sessions at $79 and preserves fulfillment of previously issued $199 Attention Pack sessions. The landing page add-on remains $199.
4. Run `npm.cmd run deploy` in PowerShell. This applies pending D1 migrations before deploying the Worker to its existing route or domain. For a Git-connected Cloudflare Worker, commit the updated `wrangler.jsonc` and `package.json` to the branch Cloudflare deploys. Set its deploy command to `npm run deploy` and give the build token permission to run D1 migrations, or run `npm.cmd run db:migrate` locally before the Git deployment.

   Verify the public homepage, footer sign-in, a test Stripe purchase and return to the campaign brief, and AD Studio. Set `CAMPAIGN_SITE_URL` if checkout should return to a specific origin. Optionally set `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and `ADMIN_ALERT_EMAIL` for notifications about submitted briefs.

   If Cloudflare reports **10181**, check the config file in the deployment’s working directory and branch. Remove any all-zero database ID for `CAMPAIGN_DB`. If you use a database with a different name, use its actual name and ID in the binding, and run migrations against that binding.

### If you already configured Cloudflare Access

You can continue to use it for admin sign-in. Use one self-hosted Access application to protect `/admin.html`, `/admin-ad-studio/*`, `/api/admin/*`, and `/api/ad-studio/social/*`. Set `ACCESS_TEAM_DOMAIN`, `ACCESS_AUDIENCE`, and `ACCESS_ADMIN_EMAIL` to match that application. Leave `ADMIN_PASSWORD` unset if you only want Access sign-in.

## Previous orders and retirement

This package does not use the legacy Supabase campaign runtime. It now supports a dedicated private Supabase Storage connection and verified Stripe invoice webhook for monthly asset delivery; no credentials are included. Existing Stripe campaign sessions can still be verified using the same Stripe account. If the earlier campaign system stored briefs, export `campaign_briefs` to CSV, prepare the import locally, and apply it to D1 before directing production traffic here:

```powershell
py tools/prepare-campaign-import.py campaign-briefs.csv campaign-briefs-import.sql
npm.cmd run wrangler -- d1 execute CAMPAIGN_DB --remote --file=campaign-briefs-import.sql
```

These files contain buyer data. Keep them outside the public assets folder and source control. The import preserves previously recorded delivery times and skips sessions already present in D1. Once the new Worker is live and verified, retire the old campaign function and the former campaign-only configuration. Keep any unrelated legacy marketplace project or Stripe webhook active while it still serves historical orders. If that webhook also receives the new campaign sessions, retain its existing guard for the Stripe metadata kind `studio-campaign-v1` so those events do not enter the legacy fulfillment flow.

## Campaign Admin and AD Studio

Click the small mushroom logo in the homepage footer to sign in to Campaign Admin. **Open AD Studio** opens the restored editor, assets, and video export tools under the same administrator sign-in.

For social publishing, reuse the previous Worker’s `AD_STUDIO_DB` binding and `BUFFER_CREDENTIAL_ENCRYPTION_KEY` secret where available. If your saved connection uses an old Supabase administrator UUID, set `AD_STUDIO_LEGACY_USER_ID` to that UUID. Otherwise reconnect Buffer under the new administrator identity. If `AD_STUDIO_DB` is not bound, AD Studio uses the existing `CAMPAIGN_DB` with dedicated publishing tables (migration 0007). Existing AD Studio databases take precedence; no existing records are deleted. For Worker-managed authentication, set the personal Buffer API token as `BUFFER_API_KEY`. Alternatively, keep a randomly generated 32-byte encryption key encoded as 64 hex characters in `BUFFER_CREDENTIAL_ENCRYPTION_KEY` and enter the personal Buffer API key once from AD Studio. These are different secrets; the encryption key is never used as a Buffer token. The Wrangler configuration preserves dashboard-managed variables on deploy (`keep_vars`). If an older deployment removed your media-hosting variables, restore them once. To enable direct video and image uploads, set the Worker variable `CLOUDINARY_CLOUD_NAME` and the Worker secrets `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET`. Existing saved Cloudinary connections still work. You can also publish using a public HTTPS MP4 or MOV file URL.

### Track and publish campaigns

From the footer mushroom, sign in to Campaign Admin. The workflow overview shows all orders by stage and the latest activity. Open an order to move it from New order to In production or Ready to email. Marking the delivery email as sent moves it to Delivered. For a recurring Monthly Asset Pack, you can move a delivered order back into production for the next delivery.

Use **New campaign** in Campaign publisher to add artwork and a case study. **Save as draft** holds it in admin. **Publish to site** adds it to the public portfolio. **View live** opens its shareable case-study link, and **Unpublish to draft** takes it off the portfolio. The form converts JPG, PNG, or WebP uploads to WebP for the site. The five bundled examples are still available.

### Example watermarks for campaign previews

The homepage gallery and enlarged previews use WebP files with the **Example** watermark baked in. Uploads in Campaign Publisher create a protected preview alongside the clean image. The clean copy is available to signed-in admins for editing and ad creation.

The built-in gallery now loads its thumbnails and enlarged previews from `/assets/campaign-examples/`. Older image links serve the same protected artwork through the Worker. Keep `assets.run_worker_first` enabled in the Wrangler configuration and deploy the Worker and assets together.

Apply migration `0005_protected_campaign_previews.sql` before deploying the Worker and static assets together. Open Campaign Publisher and click **Protect existing previews** once after deployment. Previously uploaded campaigns return to the public gallery as their previews are generated. The button can be run again after an interruption.

### Create ads for the site

Choose **Create ad** on a published campaign to load its artwork, tagline and link into AD Studio. Use **Attention Pack promotion** or **Studio portfolio promotion** when you want a general studio ad. Choose a square, portrait, or story format, edit the copy, and download a PNG or export the video. The **Publish to social** tab uses the existing Buffer connection. The separate Static feed posts workspace provides Facebook and LinkedIn previews, regular image posts using the captured PNG or a public image URL, and text-only posts that require no media hosting. Video publishing remains separate. Choose **Pop-out editor** for character layouts. PNGs and videos use a 1080 px canvas width. The story safe-zone guide is visible in the preview only. The editor prefers frame-by-frame MP4 export and uses browser recording when needed. Buffer publishing requires MP4/MOV and supports per-platform captions.

If you're upgrading an existing deployment, apply the pending campaign migrations through `0004_portfolio_industries.sql` before deploying this version. The industry migration preserves existing campaigns. `npm.cmd run deploy` applies the migrations and deploys the Worker. If Git builds still deploy with `npx wrangler deploy`, run `npm.cmd run db:migrate` first.

### Applying the AD Studio Round 2 update

Copy the update archive over your project using the paths inside the ZIP. Remove these obsolete files from your project if present:

- `public/admin-ad-studio/products.js`
- `public/admin-ad-studio/product-cutouts.js`
- `public/admin-ad-studio/assets/frame-*.png`
- `public/admin-ad-studio/assets/cube-*.png`

The archive includes prebuilt AD Studio assets. After changing AD Studio source files, run `npm ci` and `npm run build:ad-studio` before deploying. Publish the updated Worker and static assets together. This update uses the existing publishing tables.

## Email a finished ZIP

1. Open the buyer’s order in Campaign Admin. A paid Monthly Asset Pack subscription is registered automatically on the verified Stripe return, without requiring a creative brief. Confirm the matching Stripe invoice before every monthly delivery of 10 independent, randomly themed backgrounds.
2. Select **Compose in Gmail**. Verify the From address is `weirichloren@gmail.com`, attach the ZIP, and send it from Gmail. If Gmail opens the inbox, compose a message in that account using the buyer’s email from the order.
3. Select **Mark email sent** after sending. For another ZIP, select **Record another send** after the next email goes out.

Stripe Dashboard shows paid orders from buyers who leave before returning to the site or, for Attention Packs, before submitting a brief. Follow up with those buyers separately. The checkout return page confirms Monthly Asset Pack subscriptions without a creative brief; Attention Pack buyers still submit a brief and may add a landing page.

## Optional offers

- Set `CAMPAIGN_LANDING_ENABLED=true` to offer the $199 landing page after the Attention Pack brief is submitted.
- For the $49 Monthly Asset Pack, set `CAMPAIGN_MONTHLY_PRICE_ID` to the active monthly USD Stripe Price and `CAMPAIGN_BILLING_PORTAL_URL` to the Stripe Customer Portal login URL.

### Homepage service offers

The homepage now always displays the $199 one-page landing page add-on and the $49/month Monthly Asset Pack, including ten clearly labeled independent background examples and a fictional landing page. The landing page uses the existing Attention Pack post-brief checkout; it is enabled by `CAMPAIGN_LANDING_ENABLED=true` in the Wrangler configuration. The example site is at `/landing-example.html`.

The monthly card uses the existing Stripe subscription flow when `CAMPAIGN_MONTHLY_PRICE_ID` is set to an active $49 USD monthly Price and `CAMPAIGN_BILLING_PORTAL_URL` is set to an enabled Stripe customer portal login link. Otherwise it displays an email inquiry CTA instead of hiding or offering nonfunctional checkout. Service sample art in `public/assets/service-previews/` uses the same baked-in Example / PROTECTED PREVIEW pattern as campaign previews, plus the supplied translucent Pixel Shroom Studio logo. The former service-example URLs serve the new protected copies with no-store caching; unmarked originals are not deployed.

## Automatic Monthly Asset Pack fulfillment

Upload one ZIP for each UTC calendar month containing ten independent JPG, PNG, or WebP images with optional ordinary folder paths. Monthly packs are shared by paid subscribers for the matching invoice billing-period start month, not customized to an individual brand. The ZIP limit is 25 MiB; existing published monthly packs cannot be overwritten. The originals should be your finished customer files, not the watermarked website previews.

### One-time connection setup

1. In the intended Supabase project, create a **private** Storage bucket named `monthly-asset-packs`. Set the allowed MIME type to `application/zip` and a maximum file size of at least 25 MiB (prefer 25 MiB). Do not make the bucket public or add anonymous read policies. Use the project URL and legacy `service_role` API key or modern server-only `sb_secret_…` key; the key is server-only. Never put it in a browser, Git, or chat.
2. Open Cloudflare Workers & Pages → pixel-shroom-studio → Settings → Variables and Secrets. Add the following as encrypted Worker **secrets** (including non-sensitive settings, to persist dashboard values on Git deploy):
   - `SUPABASE_URL` — `https://YOUR_PROJECT_REF.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` — Supabase server-only service_role or sb_secret key
   - `RESEND_API_KEY` — Resend key with sending permission (keep the existing key if configured)
   - `RESEND_FROM_EMAIL` — a sender on your verified Resend domain (keep the existing valid sender)
   - `STRIPE_MONTHLY_WEBHOOK_SECRET` — endpoint signing secret from Step 3, not the Stripe API key.
3. In Stripe Workbench → Webhooks, add a **live-mode** event destination for `invoice.paid` (snapshot event for the account), URL `https://www.pixelshroomstudio.com/api/stripe/monthly-webhook`. Keep any existing unrelated destination. Copy its signing secret straight into Cloudflare. Test-mode events are deliberately ignored for actual delivery. The signed invoice must identify the configured $49 monthly Price ID, a paid USD subscription creation or renewal, and the buyer email. Other invoices and payment failures do not deliver.
4. Sign in to Campaign Admin, open **Monthly Asset Pack delivery**, select this month's pack month and upload a ZIP. The server checks there are exactly 10 distinct image entries with optional safe enclosing folders and stores the ZIP privately. Ensure the supplied images are valid and ready for delivery. Check the connection status and verify the ZIP is published.
5. When ready to email real paid subscribers, set the encrypted Worker secret `MONTHLY_DELIVERY_ENABLED` to `true`. This deliberate opt-in prevents accidental sends during setup. The Cloudflare Cron Trigger processes eligible deliveries every five minutes (up to four at a time); an authenticated invoice can queue while delivery is disabled. A missing ZIP waits for upload. Each Stripe invoice is a unique delivery; Resend receives a per-invoice idempotency key and short-lived private signed attachment URL. Uncertain outcomes after the retry window require manual review. "Sent" signifies email-provider acceptance, not inbox receipt. Check Resend's logs for bounces or delivery.
6. Repeat monthly: prepare 10 new backgrounds, ZIP them, publish the next month before it begins. Recurring invoices automatically dispatch that month's pack. The separate Attention Pack brief and manual delivery flow remain unchanged.

The signed webhook does not depend on the purchaser returning to the site. For subscriptions that paid before the webhook was installed, check Stripe invoice history and manually reconcile any missing deliveries; do not replay an already manually delivered invoice. The monthly administrator panel is the source of truth for automated invoice deliveries. If a provider accepts a send but the result is not recorded, retry uses the exact same request within the provider's idempotency window; after 23 hours the row requires review. Do not manually resend without inspecting provider logs. If an upload succeeds at Supabase but fails to update D1, verify the orphan object and resolve it before uploading the immutable month again.

The admin panel checks the actual private bucket connection, shows the selected ZIP filename and upload progress, and raises an existing lower bucket-specific limit to 25 MiB on upload if authorized by the configured key and global project limit. If Storage saved the object before database registration finished, retry the same ZIP: matching bytes recover registration without overwriting. Alternatively choose the month and use **Register existing ZIP** only for the intended private YYYY-MM.zip. Existing published packs remain immutable.

The Monthly Asset Pack admin panel now includes a read-only inventory of the private Supabase bucket, paired with D1 registration status. A ZIP marked Stored, not registered can be registered without uploading again. A missing published object must be restored from the original file, not replaced with different art. Old public campaign tables in Supabase do not participate in this flow. Audit them and any other legacy consumers before retiring them; do not delete storage or auth schemas. See docs/supabase-legacy-audit.sql for a read-only inventory.

If a Git-connected deployment did not apply monthly migration 0006, the authenticated admin status, verified invoice handler, and scheduled delivery handler can safely initialize the two missing monthly tables and index with CREATE IF NOT EXISTS. Status checks show Cloudflare registration database and Supabase Storage separately. No existing records are removed.
