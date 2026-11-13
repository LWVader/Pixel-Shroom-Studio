# Six-tier foil upgrade — testing branch

This update adds Emerald and Sapphire throughout the server ledger, renderer, Admin, marketplace filters, reveal lighting and local demo. Silver and Gold now use metallic sheen and ornate scrollwork frames. Emerald and Sapphire use crystalline facets, gemstones and matching filigree. Uploaded reference images guide reusable SVG styles; they are not pasted over other artwork and do not replace or redraw its subject. All finishes preserve the source composition and fit its aspect ratio.

## Approved new-drop rules

| Tier      | Initial probability | Default cap for 500 |
| --------- | ------------------: | ------------------: |
| Standard  |                 60% |    Remaining supply |
| Silver    |                 20% |                 100 |
| Gold      |                 10% |                  50 |
| Emerald   |                  6% |                  30 |
| Sapphire  |                  3% |                  15 |
| Prismatic |                  1% |                   5 |

The five rarity caps must total no more than maximum supply. These caps are defaults, not per-customer limits. Exhausted tiers downgrade Prismatic → Sapphire → Emerald → Gold → Silver → Standard; actual odds change as caps fill. The paid webhook runs the same cryptographic rejection-sampling roll under a locked artwork row. Browser animations never choose rarity. Resale transfers an existing tier and does not roll again.

## Existing drops and files

The migration assigns every existing drop `rules_version=1`, with zero Emerald/Sapphire caps and its original 70/20/9/1 percentages. Reserved, expired-reservation, allocated and delivered drops retain their committed odds, supply, caps, master snapshot and mint price. Pausing/re-enabling from the updated Admin does not upgrade them. Read-only cap inputs explain locked editions; the server independently enforces the lock.

New drops created with `configure_foil_listing_v2` use the approved six-tier rules. Saving an unreserved draft in the new Admin upgrades it to those rules; the Admin displays that policy before saving. A reserved legacy drop cannot be silently converted into a six-tier drop. Older Admin clients cannot edit a six-tier configuration.

Existing signed artifacts and their receipts are not overwritten. Newly processed Silver/Gold/Emerald/Sapphire variants use `foil-v3-metal-gem`; Prismatic retains `foil-v2-prismatic-holo`, and Standard retains `foil-v1`. The signed receipt authenticates the actual composited output. Variant dimensions remain based on the original; no uploaded reference's banana or background is copied into another artwork.

## Local visual review

Extract all changed files into the testing-branch project, stop the old demo and run:

```powershell
npm.cmd run demo
```

Open the printed local URL. Select Silver, Gold, Emerald or Sapphire, then **Replay reveal**. The artwork stays concealed until the reveal finishes. The demo generates all six tiers locally using temporary demo identities and simulated account/payment responses; it does not run real payments or consume backend supply.

## Staging deployment order

1. Keep production unchanged. Pause new checkouts in your separate staging Supabase project with `FOIL_CHECKOUT_ENABLED=false`; keep webhook recovery operating for existing sessions.
2. Redeploy the updated `modal_mint.py` in your isolated staging Modal environment with staging-only secrets. The explicit file allowlist now includes `mint-worker/finishes.mjs`, `mint-worker/prismatic.mjs` and the shared six-tier core. Keep the same package lock. Verify the deployment targets staging, not production.
3. Apply `supabase/migrations/202610190003_six_foil_tiers.sql` to staging **after** the existing foil-engine migration. For this marketplace build, retain the secondary-market migration too. Apply the new migration once; do not edit or rerun earlier migrations.
4. Deploy the updated staging `market-api` Edge Function so its filters recognize both new gem tiers. Other existing payment and access handlers continue to use the replaced SQL functions.
5. Deploy the testing-branch storefront. JS/CSS query versions prevent old tier controls and odds text being cached. Configure an unreserved six-tier listing in Admin, verify all caps and published odds, then re-enable staging foil checkout.
6. Test primary purchases, cap exhaustion, duplicate webhooks, rendering, signed receipts, both new marketplace filters and resale/download access. Merge only after those staging checks pass.

No production deployment or data modification was performed as part of this source update.

## Validation

SQL tests apply the upgrade over an existing pending legacy checkout and verify that it remains on legacy rules. They exercise all 100 roll outcomes to confirm 60/20/10/6/3/1, exhaust every rare tier in order, verify supply/odds locks and check private allocation permissions. Rendering tests cover all six signed variants, repeatability and portrait/landscape dimensions. Browser checks cover the new rarity disclosures, marketplace filter requests, locked legacy Admin settings and reset defaults. Hosted concurrent load and real Stripe/Modal payments still require your staging environment.
