# Forge & Print customer loop — installation

This update builds the rolling / collecting / upgrading / optional-printing model. It is not an exact-print-only shop. Keep the existing nine genres, brand palette, Georgia typography, hero assets, protected views and latest 14 artworks.

## Included

- Two primary choices on artwork pages: $8 digital roll, or $69 digital + included canvas claim plus $13.49 prepaid US shipping ($82.49 before applicable tax).
- Live server readiness checks; a disabled offer cannot be paid through the new UI. Existing direct-file and edition checkouts remain in an expandable existing-purchase section at their original prices.
- Protected, watermarked previews of all six uploaded tier images with actual dimensions. Private tier files are never sent as public previews.
- A continuous automatic reveal after verified payment, with artwork and actions concealed until completion. Ready editions are saved to the account automatically. Downloading the image/receipt is optional and repeatable.
- My Vault tabs: My Artwork, Forge, Print, Orders, Resell. Physical order history remains available at its existing URL too.
- Transactional same-artwork, same-tier Forge recipes (5/3/3/2/2), explicit consumption confirmation, prepared-copy output, permanent lineage, cap enforcement and idempotent operation IDs.
- Printing selected owned editions through exact artwork/tier Gelato mappings. A digital edition print is paid separately. Included canvas claims redeem once without a second product or shipping charge.
- Admin mapping fields linking each approved private print composition to artwork ID and tier. Existing Gelato preflight remains mandatory.
- Self-service password-reset requests and recovery form.
- Updated buyer FAQ and matching structured answers; shortened homepage explanations; featured links go directly to artwork details. Journal content is on About instead of the main shopping flow.

## Local demo

Run `npm.cmd run demo` and open the printed localhost URL. The controls include **Roll options**, **Forge five demo editions**, the existing simulated purchase and reveal replay. Forge uses explicitly simulated Standard inputs and a Silver result, not the production ledger or random tier allocation. No API keys, real payment or external order submission are used. Canvas ordering is intentionally disabled in this local demo; browser tests cover a mocked prepaid redemption, and your Gelato sandbox validates real integration.

## Release boundaries

Digital-only editions can be forged. Editions with any canvas claim, print order, active market listing, payment hold or previous Forge consumption cannot be inputs. Prismatic is the final digital tier. A forged output is subject to unused authorized tier inventory and the listing's total issue cap. Sold-out output inventory rejects the entire transaction; nothing is consumed.

The release does not implement 3/5/10-roll paid bundles, bundle guarantees, promotional free Prismatic prints, or combining prepaid canvas benefits. These are not advertised as live purchasing options. The old saved-ideas list remains recoverable at cart.html; it is not presented as a payment cart. Do not enable older unreleased bundle promises separately.

Printing is US-only. Standard/Silver map to 16 × 16 slim unframed; Gold to 16 × 16 thick unframed; Emerald/Sapphire/Prismatic to 16 × 20 portrait framed in Black/Dark wood/Natural wood. Product UIDs, depth, material and composition are verified by the owner against Gelato; the preflight checker cannot infer those attributes from a UID. Never substitute a generic product or the wrong artwork's file.

## Install the update

1. Back up your project and database. Extract this update over the project root, preserving relative paths. No existing listings or purchases are deleted.
2. Run the new migration after all existing migrations through 202610220001:

```powershell
npx.cmd supabase db push
```

The new file is `supabase/migrations/202610220002_forge_print_loop.sql`. It is additive and also makes existing ready paid editions visible in their owner's Vault. It does not modify previously delivered bytes, signatures, prices or licenses.

3. Deploy the changed Edge Functions:

```powershell
npx.cmd supabase functions deploy forge-api
npx.cmd supabase functions deploy mint-access
npx.cmd supabase functions deploy mint-checkout
npx.cmd supabase functions deploy print-api
npx.cmd supabase functions deploy stripe-webhook --no-verify-jwt
```

Preserve existing gateway/auth settings for the browser functions. The Stripe webhook must accept Stripe's signed request without a Supabase JWT; its own raw-body signature verification remains mandatory. A changed shared Gelato module is included in these deployments.

4. Keep the existing Modal worker deployed and its scheduled recovery running. It processes forged outputs through the existing private inventory pipeline. No new rendering dependency is needed. Signed ready outputs trigger automatic Vault persistence in the database.

5. In Admin, save all six finished tier images. This now also uploads protected tier previews. For existing locked collections, open the listing and use **Prepare protected previews for saved tier images**. This regenerates watermarked public previews without replacing or unlocking any signed private sources. Existing purchases retain their earlier checkout path.

6. In Admin → Gelato products, create one approved canvas composition for each artwork/tier. Enter the artwork ID and tier, exact Gelato UID, template dimensions, and complete the preflight. Use the intended tier-specific later print price, e.g. Standard/Silver $49, Gold $55, Emerald/Sapphire $79. A Prismatic mapping needs an explicitly chosen paid-print price; no free promotional claim is activated in this release.

7. Test with Stripe test credentials and Gelato sandbox first. New server flags default to off:

```powershell
npx.cmd supabase secrets set FORGE_PRINT_ENABLED=true FORGE_ENABLED=true
```

`FOIL_CHECKOUT_ENABLED=true` is still required by the existing mint checkout. Digital checkout also requires all six protected previews and ready prepared-copy inventory. The new prices are enforced by the server; changing browser HTML cannot change a payment amount.

Only after the six active print mappings, Gelato credentials and mode agree with Stripe:

```powershell
npx.cmd supabase secrets set FORGE_PRINT_CANVAS_ENABLED=true
```

Keep the existing Gelato flags and API key configuration. Test payments require Gelato sandbox; live payments require the live Gelato launch settings. Before live new roll checkout, configure Stripe Tax appropriately and set `FORGE_PRINT_TAX_ENABLED=true`; live roll checkout rejects incomplete tax configuration. Confirm live webhook tax calculation completes. Do not paste credentials into public/config.js or Git.

8. Add your production and staging `collection.html?recovery=1` addresses to Supabase Auth's allowed redirect URLs. Configure email delivery so signup confirmation and password-reset emails can reach customers.

9. Validate and deploy the storefront through your existing Cloudflare workflow:

```powershell
npm.cmd ci
npm.cmd run format:check
npm.cmd run test:all
npm.cmd run build
npx.cmd wrangler deploy
```

This package does not deploy to your accounts or process any live payment or Gelato order.

## Operational behavior

- Payment is verified before the tier is assigned. The new Stripe metadata branches preserve old checkout handling. Tax is collected separately from the reserved offer subtotal; the verified subtotal and currency must match.
- A new Forge request cannot choose a custom output tier or supply an artwork price. Duplicate inputs, other owners' editions and stock exhaustion reject atomically. The same owner/request key returns the same output. On a lost response, retry the same selection. If the browser was closed, check the Vault for the pending/ready output before trying another operation.
- Forge consumption disables new downloads/resale/printing of those edition records but does not erase existing downloaded files or revoke promised usage rights.
- A canvas-inclusive purchase creates one non-transferable claim. Redemption checks the original paid edition, holder, environment, mapping and ownership under a database lock. A repeated redemption of the same order returns it; a second order cannot reuse the claim.
- Quote creation is not a print reservation. Checkout rechecks ownership under a row lock. An edition attached to a non-canceled print order cannot be transferred or forged. Abandoned pending print checkouts must expire/cancel before it becomes eligible again; include this in operator reconciliation.
- Gelato submission remains once-only with ambiguous responses routed to studio review. Provider shipping budgets are stored separately from the customer's flat/prepaid shipping price; a changed supplier quote requires review.
- New roll refund/dispute events freeze the original edition and derived Forge outputs/claims for review. Previously submitted physical production cannot be recalled automatically. An operator must review production and the lineage before restoring access. Existing older-order reversal workflows remain unchanged.
- Private signed download URLs retain their short expiry. A previously issued URL can remain usable until it expires after an ownership/eligibility change; no system can recall files already downloaded.
- Product mappings are separate approved print-ready copies, not arbitrary private downloads. Gelato receives only the dedicated mapped print source after the corresponding print consent/order flow.

## Checks included

Unit/integration tests exercise real PostgreSQL-compatible transactions for caps, ownership, consumed inputs, idempotent Forge output, prepayment inventory, automatic collection persistence, one-time canvas redemption and reversal lineage. Desktop/mobile browser tests cover the two-choice detail page, sign-in handoff, protected viewer, Forge retry key, prepaid print confirmation, existing checkout and continuous reveal. Mocked browser payment/provider responses do not establish live-account readiness: complete a Stripe test payment and Gelato sandbox redemption in your own environment before activating production.

## Verification environment note

Cloudflare local runtime startup encountered `uv_interface_addresses` in this execution environment. The Node/Worker routing fixtures, browser flows and build were checked separately; rerun `npm.cmd run test:runtime` on your development machine before deployment.
