# Gelato physical products

This update replaces the active canvas/apparel shopping pages, homepage product examples, public feed, FAQ and physical-purchase wording. Digital original purchases, numbered editions, collection reveals, marketplace payments, signing keys and the Modal mint processor retain their existing paths. Do not replace your live digital Stripe credentials to test this integration.

The initial physical checkout supports **US delivery, USD, one mapped product variation per checkout and quantities 1–10**. Each apparel size/color or canvas size is its own mapping to an exact Gelato product UID. It does not guess UIDs or create an entire Gelato catalog automatically. Other products and countries require appropriate mappings and address/tax validation before expanding checkout.

## Installation

1. Replace the files supplied in the update, preserving their folders. The new migration follows the existing studio migrations: `supabase/migrations/202610210002_gelato_print_orders.sql`.
2. Apply pending migrations to your correctly linked Supabase project:

   ```powershell
   npx.cmd supabase db push
   ```

   You can instead run the new SQL in Supabase SQL Editor after all earlier required migrations are installed. This creates separate private product, quote, order and event tables plus the private `gelato-print-files` bucket. It does not clear artwork, create a Gelato order.

3. Copy the credential template and edit it locally:

   ```powershell
   Copy-Item docs\gelato.env.example gelato.env.local
   ```

   Use a Gelato **sandbox API key** and a separate Stripe **test** key in `GELATO_STRIPE_SECRET_KEY`. Leave your existing `STRIPE_SECRET_KEY`, original `STRIPE_WEBHOOK_SECRET`, Connect configuration and mint keys unchanged.

4. In Stripe **test mode**, add the existing URL `https://YOUR_PROJECT_REF.supabase.co/functions/v1/stripe-webhook` as a webhook endpoint for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `charge.refunded`, `refund.updated`, `charge.dispute.created` and `charge.dispute.closed`. Put this test endpoint's signing secret in `GELATO_STRIPE_WEBHOOK_SECRET`.
5. Upload secrets and deploy the two functions:

   ```powershell
   npx.cmd supabase secrets set --env-file gelato.env.local
   npx.cmd supabase functions deploy print-api
   npx.cmd supabase functions deploy stripe-webhook
   npm.cmd run build
   ```

   Deploy the storefront with your existing deployment method. A source ZIP does not deploy Supabase functions or run SQL automatically.

## Map physical products

Open Owner access → Current images → **Gelato physical products** → Load products / orders.

In Admin → Images, upload the six finished tier images once. Artist defaults to **LWVader** and no per-artwork price is entered. Digital and canvas roll prices remain centrally configured. Existing direct-purchase prices and already-paid order snapshots are preserved.

In Admin → Gelato, choose the same artwork ID and tier. The backend loads its private PNG/JPEG from `foil_tier_assets`, verifies its registered SHA-256, and creates an identical private print snapshot. There is no second browser upload. The artwork ID identifies the image throughout the site, Vault and print mapping; the Gelato Product UID separately identifies the physical canvas/frame. A preview is provided using a short-lived, administrator-only signed link. The public product preview remains protected.

Enter the exact Gelato Product UID, size/finish and template requirements. No per-image price field, manual review checklist, readiness checkbox or publication checkbox is needed. **Publish product** runs the technical checks and opens a confirmation containing the result and warnings. Cancel returns to editing without publishing. Failed checks show the reason; server-side checks repeat against the stored bytes and require explicit publication confirmation.

The simplified shared-source flow supports PNG/JPEG up to 100 MB. WebP and PDF sources are not automatically approved or converted. Wrong aspect ratios and insufficient resolution are rejected rather than cropped, stretched or upscaled. The checker measures technical properties; it does not certify visual quality, profile fidelity, or Gelato production approval.

Roll checkout prices remain unchanged. Existing later-print redemption prices are preserved; new mappings use server-side tier defaults (Standard/Silver $49, Gold $55, Emerald/Sapphire/Prismatic $79), never prices supplied by the browser. No free print promotion is enabled. Tax codes remain product-specific configuration. Existing standalone products and paid orders remain available through their existing payment paths.

## Sandbox test

After mappings are ready, set `GELATO_CHECKOUT_ENABLED=true` in the local secret file, keeping `GELATO_MODE=sandbox`, `GELATO_LIVE_ENABLED=false` and a Stripe test key. Upload the revised secret file again.

1. Sign in to a studio account and open `/canvases.html` or `/apparel.html`.
2. Choose a mapped variation. The page clearly marks test mode. Enter a US address and agree to the delivery-data sharing required for the Gelato quote.
3. Request shipping, choose a method and review product + delivery pricing. Changing delivery fields invalidates the quote. Quotes can be first used for 15 minutes; an already-created Stripe checkout has its own expiry.
4. Complete Stripe test checkout. Follow the result to `/print-orders.html`.
5. The verified Stripe webhook atomically marks payment and claims one fulfillment submission. A fresh quote checks that the selected delivery method and configured cost limits still work. The sandbox payload explicitly uses `orderType: "draft"`, so this code never requests regular production from a test payment, even if the wrong Gelato key was supplied.
6. Check the order in Gelato and use the account status page. Gelato sandbox statuses may be canceled; no sandbox order ships. This implementation uses authenticated Get/Search API reconciliation rather than trusting an unsigned Gelato webhook.

No real Gelato request, charge or shipment was made while preparing this update. Automated checks use fixtures. Test your real sandbox account, mappings, API access and file downloads before considering live use.

## Production activation

Set a **live Gelato key**, `GELATO_MODE=live`, `GELATO_LIVE_ENABLED=true`, and a live `GELATO_STRIPE_SECRET_KEY` (or clear the separate key to use the existing live `STRIPE_SECRET_KEY`). Configure the correct live signing secret in `GELATO_STRIPE_WEBHOOK_SECRET`, or use the existing live endpoint secret if that same endpoint already receives the events. Complete Stripe Tax settings and applicable registrations/product tax-code review before setting `GELATO_STRIPE_TAX_READY=true`. `GELATO_CHECKOUT_ENABLED=true` opens physical checkout only when the server's other guards pass.

Live payment and live fulfillment incur real charges and ship goods. A small end-to-end live sample is a real purchase, not a free API simulation. Shipping is quoted dynamically and availability can change before production. The customer sees applicable tax at Stripe checkout; the tax destination is the same immutable delivery address used for the quote, saved on the order-specific Stripe customer. The shipping address is not editable at Stripe; the customer must return for a new quote to change it.

## Payment, duplicate protection and order support

- Client requests contain product/quote IDs and delivery details, never trusted prices, product UIDs or private file URLs. Server mappings set production files and prices.
- Quotes and orders are private and tied to the authenticated account. Public product views omit source file paths and provider credentials. Quote creation is limited to ten requests per account per minute.
- The verified Stripe event must match the bound session, currency, pre-tax subtotal including delivery, and sandbox/live mode. A database transaction claims a paid order once before an external create request.
- Private print links last seven days and go to Gelato for production; they are never returned in customer quote/order responses. Gelato and its fulfillment partners can access/retain print content under their own terms. Link expiry is not a promise to erase a provider's downloaded copy.
- A create timeout or uncertain failure becomes `needs_review`. There is no blind create retry, because an accepted external order may exist even if its response was lost. Owner **Refresh / reconcile** searches Gelato by the stable order reference and updates a uniquely matching order. No match or multiple matches require manual investigation; do not create a duplicate. A crash after claiming submission also requires reconciliation.
- If payment is paid but the row is still queued, the owner refresh action can claim that not-yet-submitted order. Sandbox/live launch guards still apply.
- Refunds and disputes flag physical orders for review. The integration does not automatically cancel an order already sent to production or promise refunds. Review the Gelato dashboard and contact the buyer promptly; production can prevent cancellation. Clear, applicable physical return terms should be published before live launch.
- Order tracking is refreshed through authenticated Gelato API reads and only shown to the purchasing account. Physical orders have no original-file delivery endpoint, signed digital-edition receipt, random rarity roll or collection transfer.
- Physical products use `/api/print-products` and the authenticated `print-api` checkout flow. Configure products and orders in Admin → Gelato.

## Useful references

- API authentication: https://dashboard.gelato.com/docs/
- Order quote: https://dashboard.gelato.com/docs/orders/v4/quote/
- Order create / draft: https://dashboard.gelato.com/docs/orders/v4/create/
- Get/Search: https://dashboard.gelato.com/docs/orders/v4/get/ and https://dashboard.gelato.com/docs/orders/v4/search/
- Product mapping: https://support.gelato.com/en/articles/8996102
- PDF design requirements: https://support.gelato.com/en/articles/8996349 (use product-specific guidance as well)
- Stripe Tax with Checkout: https://docs.stripe.com/tax/checkout/page

Run `npm.cmd run check`, `npm.cmd test`, `npm.cmd run prints:check`, `npm.cmd run test:e2e`, and `npm.cmd run demo:test`. The existing demo remains a digital edition/reveal demo; physical sandbox testing uses mapped Gelato products and separate test credentials as described above.

## Owner artwork preflight update (22 October 2026)

Apply `supabase/migrations/202610220001_gelato_preflight.sql`, deploy `print-api` again, and rebuild/redeploy the supplied storefront files. No new credentials or packages are required. The private product table gains template requirements and check evidence; the public catalog view still excludes private source information.

Use Admin → Gelato. The automatic checker measures the selected uploaded PNG/JPEG, hash, dimensions, aspect ratio, effective resolution, transparent-background compatibility and configured margins. It has no manual review checklist. The final Publish confirmation records the administrator’s decision, without fabricating individual inspection attestations. PDF properties and visual/color quality are not certified.

Deploy the updated `print-api` function together with the storefront files. No new migration or secret is needed. Existing product mappings are not automatically unpublished, and paid order snapshots are preserved.

## Planned canvas rolls, digital bundles and Forge

See `CANVAS-DIGITAL-FORGE-WORKFLOW.md` for the October 22 offer specification: US-only 16 × 16 unframed and 16 × 20 portrait framed mappings, $69 canvas rolls plus $13.49 shipping, digital bundles, later print pricing, one-time Prismatic promotions and corrected economics. It preserves hold-until-redeemed production for the canvas bundle. This document addition does not implement or enable those new commerce paths; the existing physical-product checkout is still the flow described above.
