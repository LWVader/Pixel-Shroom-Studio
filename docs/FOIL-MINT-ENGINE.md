# Foil edition engine

This update adds an opt-in numbered digital edition system. It is not a blockchain mint or transfer system. Existing ordinary digital purchases and eBay links remain supported. No production database, payment or hosted service was changed while preparing this update.

## Components

- `artworks` remains the parent master listing; `foil_listings` stores an immutable master/signature snapshot, supply, price and rare-tier caps. `mints` is the child ledger with account owner, order, paid mint number, tier, queue lease, final path, hash and receipt.
- Stripe checkout reserves capacity, not rarity. A verified paid webhook allocates the next number and generates an unbiased 1–100 cryptographic roll within the locked database transaction. Tier and number are never rerolled on payment replay, render failure, retry or refund.
- Initial outcomes: 70% Standard, 20% Silver, 9% Gold, 1% Prismatic. Exhausted caps downgrade Prismatic → Gold → Silver → Standard. Standard has no independent cap beyond maximum supply. Dynamic odds and caps are disclosed before purchase. Reserved checkouts count against availability until Stripe actually expires them; a local timer never releases a possibly payable session.
- PostgreSQL is the durable job queue (`FOR UPDATE SKIP LOCKED`, ten-minute leases). A separate Node 24/Sharp worker handles one high-resolution image at a time. No Redis or native-image runtime in Cloudflare is required.
- Standard preserves the appearance, not the exact master bytes. All outputs are new WebP files containing distinct mint metadata. Silver has a metallic frame; Gold adds a frame and 20% saturation; Prismatic uses a color inversion/tint and spectrum frame. This is a still-image foil treatment; the reveal animation is browser presentation.
- Every derivative is hashed after metadata and rendering. An Ed25519-signed, detached JSON receipt binds its exact final bytes to its number, tier, master hash and rendering version. Original C2PA metadata is not copied onto modified bytes. The master signature remains a source/integrity statement, not proof of exclusive ownership or copyright.
- Files use the private `minted` bucket, independently of private `originals`. Only an authenticated owner or valid order secret can request a 60-second private URL for a paid ready mint. No master is delivered for foil orders, including when that edition is paused. Existing pre-conversion digital orders retain their original delivery.

For Modal hosting, follow `docs/MODAL-SETUP.md` instead of the always-on server instructions in steps 4–6 below. The database, Stripe and Supabase function prerequisites still apply.

## Deployment order

1. Back up the database and test on a staging project with Stripe **test** keys. Apply existing migrations first, then `supabase/migrations/202610190001_foil_mint_engine.sql` once in Supabase SQL Editor or through your normal migration tooling. This migration is versioned and is not intended to be rerun manually.
2. Run `npm.cmd ci`. Deploy the updated `create-checkout`, `stripe-webhook`, `order-status`, `download-original`, plus new `mint-checkout` and `mint-access` functions. Their JWT gateway setting is false because functions validate either a user token or order credentials themselves. The webhook continues to verify the raw Stripe signature. Existing Supabase and Stripe function secrets remain required.
3. In Stripe, keep the existing webhook destination and subscribe it to `checkout.session.completed`, `checkout.session.async_payment_succeeded` and **`checkout.session.expired`**. Add the Collection URL to your Supabase Auth allowed URLs and configure production email confirmation/password recovery through your existing Auth settings.
4. Prepare a persistent private Node 24 server for `mint-worker/worker.mjs`. Cloudflare's storefront deployment alone does **not** run this worker. Allow memory for large originals (start with at least 4 GB, one worker). The decoder caps inputs at 100 million pixels; WebP outputs fit within 16000 × 16000 while preserving aspect ratio. Deploy the same package lock on every worker.
5. Generate a dedicated mint key once: `npm.cmd run mint:keys -- C:\Private\PixelShroomMintKeys` (or an absolute private server path). Keep the private PEM and service-role key off Git and outside public assets. Back up the PEM securely. Do not reuse the master-signing key. The tool refuses to overwrite keys.
6. Copy `mint-worker/.env.example` to the private server's `mint-worker/.env` and fill in its values. Run `npm.cmd run mint:once` to register the trusted public key and process at most one job; then run `npm.cmd run mint:worker` under a process supervisor/container restart policy. Keep the private env file only on that server.
7. Deploy the storefront using the existing `npx.cmd wrangler deploy` flow. In Admin, edit a signed image listing, select the optional foil mode and set supply/caps. Defaults are supply 500, Silver 100, Gold 45 and Prismatic 5. Caps must sum to at most supply. Caps/master/mint price lock after the first reservation. Disabling a previously configured foil edition pauses minting; it does not turn its buy button back into master delivery.
8. Only after the processor and test purchases work, set the **Supabase function secret** `FOIL_CHECKOUT_ENABLED=true`. This is a launch gate, not a public setting. Keep it unset or false while preparing the infrastructure. Existing digital checkout and eBay purchases work independently.

Examples of function deployment commands (run from the project root):

```powershell
npx.cmd supabase functions deploy mint-checkout
npx.cmd supabase functions deploy mint-access
npx.cmd supabase functions deploy create-checkout
npx.cmd supabase functions deploy stripe-webhook
npx.cmd supabase functions deploy order-status
npx.cmd supabase functions deploy download-original
npx.cmd supabase secrets set FOIL_CHECKOUT_ENABLED=true
```

## Operating and recovery

The worker reconciles pending Stripe sessions at startup and every minute. It releases reservations only for provider-confirmed expired sessions, recovers sessions that were created before their database linkage failed, and fulfills paid sessions through the same idempotent database function. A reservation for which Stripe never created a session is intentionally held for studio review: do not release it on a timeout. Verify no payable session exists in Stripe, then mark the pending order failed and its reserved mint released in a service-side database transaction. Never edit an allocated mint's tier or number.

The recovery scan pages through pending orders in creation order. Monitor unlinked reservations and render failures. Before a large drop, run staging throughput and database-lock tests against your hosted PostgreSQL instance.

Retries keep the exact allocated number/tier. After five render failures or expired final leases, the mint stops for review. Investigate the master file or worker first, then an authenticated admin can call `retry_foil_job(target_mint)` through the Supabase SQL/RPC tooling. Do not put a service-role key into Admin's browser. Private storage artifacts from lost leases are unreferenced and can be deleted after confirming no ledger row references them. A stale worker cannot overwrite a current artifact because each lease writes a different private path.

Counters report paid **allocations**, including rendering jobs; they do not pretend queued work has already been rendered. Refunded editions keep their original number and consume supply. Use your existing refund procedure and mark the corresponding order `refunded`; this stops issuing new private URLs. Already downloaded files cannot be recalled. Optional internal secondary sales, account-to-account transfers and their financial recovery are documented in `docs/SECONDARY-MARKETPLACE.md`. Blockchain token issuance is not implemented.

Collection access uses the purchaser's Supabase Auth account; it does not match accounts merely by email. Buyers must retain their account access. The confirmation link also retains the existing high-entropy order credential. Signed receipts prove file integrity and studio issuance, not current holder identity or market value. Existing personal/commercial permissions remain unchanged.

## Verification and tests

`npm.cmd run test:coverage` covers PostgreSQL cap exhaustion, supply reservation, paid-only allocation, webhook replay, lease fencing, private RPCs, legacy delivery, signed master validation and all four generated tiers. `npm.cmd run test:e2e` covers browser paths. `npm.cmd run mint:once` is the staging processor smoke test, not a production readiness certificate.

The new `/verify-mint.html` hashes the selected derivative locally, fetches the trusted registered studio public key and verifies the detached receipt. The private key never reaches the browser. `/verify.html` remains the separate unchanged-master verifier.

Technical references: https://sharp.pixelplumbing.com/api-composite/ , https://sharp.pixelplumbing.com/api-output/ , https://docs.stripe.com/api/checkout/sessions/expire .

Buy-button opening effects and the paid-only server roll are documented in `docs/BUY-OPENING-FLOW.md`. The animation does not allocate rarity or bypass payment verification.
