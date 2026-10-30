# Payment → reveal → Vault → canvas → shipping → Gelato draft

## Results from this run (October 30, 2026)

The new journey suite passed for all six tiers on desktop and mobile (12 tests). A further 36 related browser regressions and all 92 unit/integration tests passed. These are isolated provider fixtures: no actual Stripe charge or Gelato order was created. The UI uses real site modules; draft payloads use the real server request builder. Existing database and fulfillment tests independently cover payment verification, allocation, claims, replay protection and draft-only submission.

A read-only check of the deployed Supabase project found one catalog edition, artwork **48**:

- Six protected tier previews are present and supply remains.
- The edition reports `enabled: false`.
- Digital and canvas rolls both report closed.
- Print checkout reports disabled; Gelato reports draft/test mode and US delivery.
- The deployed availability response does not yet report Stripe test/live mode or complete mapping readiness. Those fields require deploying the updated `forge-api` in this patch.

These observations do not prove which Stripe key is currently deployed, whether all 12 current print mappings exist, whether copy preparation has finished, or whether the private print compositions are ready. Public preview dimensions do not certify print quality.

## 1. Watch the complete journey locally

Extract this update over the current project. From PowerShell:

```powershell
npm.cmd ci
npx.cmd playwright install chromium
npm.cmd run test:journey:headed
```

This opens desktop Chromium for six journeys. Five cover Canvas + Digital Rolls with prepaid canvas redemption; Emerald covers a Digital Roll followed by separately paid optional printing. The browser visits a clearly labelled simulated Stripe checkout. This does not use your live credentials or real customer orders.

For desktop and mobile automation:

```powershell
npm.cmd run test:journey
```

Coverage includes saved account shipping, artwork selection, checkout requests containing only artwork/offer IDs, no reveal on an unpaid return URL, one concealed-to-revealed animation, account ownership, correct tier and frame UID, saved-address autofill, unchecked production consent, payment/redemption, one USD Gelato draft payload, a dedicated print file instead of the digital download, and order history surviving reload without resubmission.

## 2. Check the actual deployment without creating a checkout

Deploy the readiness fix using your current project (no secret changes):

```powershell
npx.cmd supabase functions deploy forge-api --project-ref decizwtgsqhjdgjiqbui
npm.cmd run test:journey:preflight -- --artwork 48
```

The probe reads the Supabase public configuration in your local `public/config.js`, calls only `availability` and `catalog`, and prints nonsecret readiness flags. It never calls checkout, allocates a copy, uploads a file, submits an order or logs a key/address. Use the real artwork ID for another listing. For a staging copy, ensure its local config points to the staging project before running this command.

The new backend gate requires **all 12 current canvas mappings** before advertising a canvas roll as available. A missing/failed readiness RPC keeps the offer closed; do not loosen this gate. The existing `canvas_options_ready` RPC comes from the prior canvas migrations. If those have not been applied, review `supabase db push --dry-run` before pushing them.

`readyForProviderTest: true` means the exposed flags are suitable for a test-payment/draft run. It does not establish webhook delivery, worker signing, account email delivery, private print quality or provider fulfillment.

## 3. Prepare a provider test without replacing production keys

Use an isolated staging storefront and Supabase project for the full provider test. Keep the production Stripe key, live customer database and existing orders unchanged.

In staging only:

- Apply the current migrations and deploy the current functions, including `mint-checkout`, `stripe-webhook`, `order-status`, `mint-access`, `forge-api` and `print-api`.
- Configure the staging public Supabase URL/key, Auth email redirects and a staging `SITE_URL`; payment returns must land on the same staging storefront.
- Set `STRIPE_SECRET_KEY` to a test-mode key. Configure the matching test-mode Stripe webhook signing secret and destination for the staging `stripe-webhook`. Do not use the production signing secret. Deploy that webhook with `--no-verify-jwt`; provider signatures are verified in code.
- For separate optional-print payments, configure `GELATO_STRIPE_SECRET_KEY` with the same test environment and its matching webhook signing secret. This key does not control the first roll payment.
- Configure `GELATO_API_KEY`, `GELATO_MODE=sandbox`, `GELATO_LIVE_ENABLED=false`, and `GELATO_CHECKOUT_ENABLED=true`. This application's sandbox switch creates supplier drafts; it does not imply a separate Gelato API hostname or a verified sandbox credential.
- Enable staging `FOIL_CHECKOUT_ENABLED`, `FORGE_PRINT_ENABLED` and `FORGE_PRINT_CANVAS_ENABLED`. Live Stripe tax flags are not a way to enable test mode.
- Set up the staging mint worker with staging database/storage credentials and signing configuration. Confirm the six uploaded tier files and per-copy inventory are prepared before enabling the edition.
- Publish all **12** ready version-3 Gelato mappings for the chosen artwork: three unframed 16×16 thick mappings (one per Standard/Silver/Gold tier), six 16×24 portrait mappings (three frame choices for each Emerald/Sapphire tier), and three 24×24 Prismatic framed mappings. Use the dedicated print compositions and exact supplied UIDs.

Do not copy production buyer records or private order files to build a test account. Use a dedicated collector account and your own delivery address.

## 4. Run one real provider test

1. Run the read-only preflight against the staging config; all checks must pass.
2. Sign in to the staging Vault and save a US delivery address.
3. Select the staged artwork and Canvas + Digital Roll: $69 + $13.49 shipping before any applicable tax. In Stripe test mode use a documented test payment method; never enter a real card into a test checkout.
4. After Stripe confirms payment, verify one reveal and one edition in the same account's Vault. Reopening the receipt must preserve the same tier, copy and hash.
5. Open Print for that edition. Confirm its size, frame and approved composition, and verify the saved address. Give production-file consent explicitly.
6. Redeem the included canvas. No second Stripe payment should open. Record the internal order reference.
7. Confirm the supplier order appears in Gelato as a **draft**, in USD, with the selected UID, correct recipient and dedicated print file. Leave it as a draft. Refreshing Vault Orders must not create a second supplier order.
8. Separately test a Digital Roll ($8), then optional canvas printing through test-mode print checkout. That path requires a second payment; it must create no order before that payment is verified.

The genuine RNG chooses the tier. Do not submit a desired tier from the browser, reroll a paid order, or purchase repeatedly to force every tier. The local suite covers each tier deterministically; the provider test validates one actual roll.

If a provider request times out, search Gelato using the existing order reference before retrying. Record status codes/reference IDs when troubleshooting; never share keys, signed file URLs, card details or shipping addresses.
