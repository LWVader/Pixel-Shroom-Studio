# Edition catalog relaunch and cards

The source update refines the live homepage around numbered editions, a compact three-step purchase explanation and the latest 14 artworks. It preserves the hero, palette, fonts, 16px category navigation, nine genre pages, physical-product links and payment paths. Edition cards use a protected artwork image, collection availability, tier chips and expandable dimensions/odds/delivery information. Direct-file listings keep their existing checkout while they remain published.

## Deploy and remove the old primary artwork listings

1. Replace the files in this update and deploy the normal storefront build (`npm.cmd run build`, then your existing deployment process).
2. Ensure the existing edition migrations through `202610190006_prehashed_copy_inventory.sql` are already applied, then apply `supabase/migrations/202610210001_catalog_relaunch.sql` in Supabase. If using the linked CLI project, use `npx.cmd supabase db push`; otherwise run this migration in the Supabase SQL Editor. Applying it installs the owner action and does **not** remove any listings.
3. Sign in through Owner access. In Current images, choose **Remove current artwork listings for reload**, review the count and confirm.
4. Allow up to 60 seconds for the Worker catalog cache to expire, then refresh the public homepage. It should show the new-collections preparation state until you publish replacements.

The action soft-removes every current primary artwork row, including drafts and NFT entries, from the public catalog and Current images. It archives the rows, sets their existing deletion marker and disables their primary edition checkout. It does not delete files, orders, signatures, issued editions, copy inventory, receipts, customers, Gelato product mappings or secondary marketplace records. Existing paid fulfillment retains its assigned edition. Previously initiated checkout sessions are not canceled by this action; existing payment processing and fulfillment rules continue to apply.

An admin-only audit row in `catalog_relaunch_runs` stores the prior listing state and edition enable flags. A stale listing count aborts the transaction so newer uploads are not accidentally included. Unauthenticated and non-admin users cannot run the action. No live catalog reset was performed while preparing this package; it requires your authenticated owner action after the migration is installed.

## Reload the six variations

Create a fresh listing, register its artwork identity and upload Standard, Silver, Gold, Emerald, Sapphire and Prismatic finished images. Review each image's format and dimensions, set supply and tier caps, then save. Publishing still requires all six images. The worker prepares the authorized copy hashes; checkout remains unavailable until inventory is ready and you enable it.

Use a new unused LWV serial for a new artwork row; old serials remain reserved for historical verification. Previously reserved or issued collections retain their locked source images, rules and receipts. Do not rename old serials or delete history to reuse them. The supplied reset is a catalog retirement action, not an inventory reset or a way to reroll earlier purchases.

If the new admin action is unavailable, check that the migration reached the correct production Supabase project and refresh its API schema. Do not insert service-role credentials into public files.

## Tests

`npm.cmd run check`, `npm.cmd test`, `npm.cmd run test:e2e`, and `npm.cmd run demo:test`.

Database tests check owner authorization, stale-count rollback, no automatic reset during migration, soft removal, checkout disabling and preserved order/edition records. Browser tests check the owner confirmation action and the existing browsing/payment/reveal paths on desktop and mobile.
