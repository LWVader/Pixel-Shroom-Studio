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

For each sellable variation, enter its title, category, size/color/material label, exact Gelato product UID, **retail product price** in USD, appropriate Stripe product tax code, and a public studio product-preview URL. Supported preview origins are the configured studio site and its Supabase public `previews` bucket. Do not use signed private links for previews.

Upload a **dedicated print-ready PNG, JPEG or PDF, up to 100 MB**, and confirm it meets that particular product's requirements. This release submits one `default` print area; it does not support a second/back print area, embroidery digitization or multipage page-count configuration. Do not activate a UID requiring an unsupported print setup. Use Gelato's product-specific templates for canvas wrap/bleed, apparel placement, file dimensions, safe areas and color settings. A WebP digital edition is not automatically sent or converted to a print source. No automatic crop, upscale or print-readiness certification is performed.

Confirm the tax code against Stripe's applicable product category, especially apparel. Set retail prices to cover supplier production costs, shipping treatment, applicable supplier taxes, payment fees, returns and your intended margin. The quote guard rejects production costs above the configured retail product subtotal, but it is not a profitability calculation and does not prove every supplier tax or surcharge is included.

Publish the mapping only after reviewing its preview and print source. Print source uploads are immutable paths; a revision uses a new uploaded path. Pending and paid orders retain their frozen mapping, file path, price and recipient even if you edit the current product.

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

In Owner access → Current images → Gelato physical products, choose a new mapping or edit one. Load a dedicated print file, enter the exact product UID and its Gelato template/catalogue URL, and set the finished print/design area in inches. Starting-size presets include the requested 5×7, 8×10, 11×14, 12×16, 18×24, 24×36 and approximate 8.5×3.5 mug area. They do not validate a UID or replace its template. Enter bleed and any additional canvas wrap per side in millimeters. If your dimensions already represent the full print area, do not add the same margin again. Choose the product minimum (150 or 300 PPI); 300 remains the recommendation.

Click **Safe check selected product** to measure the file and inspect the preview. Use Fit, 200% or 300% zoom to review edges; the dashed guide shows the entered safe-zone boundary. Complete all visual/export confirmations, re-run Safe check, mark ready, and publish. A hidden draft can retain a blocked check. Any change to artwork, UID, variation, requirements or review invalidates the browser check. Editing an existing mapping requires a fresh check; to see its private preview, select the original local source again. The existing stored source can be checked server-side without downloading its URL into the public catalog.

Automatic raster checks: actual PNG/JPEG signature and header dimensions, store size/pixel limits, effective PPI, aspect-ratio tolerance (1%), PNG alpha support when transparency is required, and a SHA-256 hash of the exact file. Raster decode is also checked for newly selected local files. The server reads the uploaded private bytes again and recomputes dimensions/hash/report before saving. A renamed extension or stale client hash cannot authorize a different source. No cropping, resizing, upscaling, color conversion or Gelato order/API request occurs during Safe check.

Manual checks remain essential: the UID's real template/print area; halo/stray-pixel and DTG effects; actual transparency and safe-zone contents; fonts/linked assets/line weights; original detail; color profile/gamut/soft proof and product-specific ink settings. A PNG alpha channel does not prove the background is transparent. ICC presence does not prove sRGB. The tool cannot detect all interpolation or certify print quality. Do not blindly apply rich-black recipes, a paper proof profile or a universal 2 mm bleed to all substrates. Gelato's general PDF guidance specifies 4 mm bleed, at least 4 mm safe area and PDF/X-4/GRACoL 2006 output intent, with product-specific color guidance; use the exact template if different.

PDFs have no single intrinsic pixel size. This checker identifies PDF format but does not parse page/bleed boxes, embedded raster PPI, fonts, encryption, output intent or PDF/X compliance. External PDF preflight and the additional PDF confirmation are mandatory for publication. The result labels these properties unmeasured; it never reports a fabricated DPI or Gelato approval.

Previous products are not automatically unpublished by this additive migration. Recheck existing mappings before reopening checkout if their specifications have not been reviewed. Existing paid order snapshots are preserved.

## Planned canvas rolls, digital bundles and Forge

See `CANVAS-DIGITAL-FORGE-WORKFLOW.md` for the October 22 offer specification: US-only 16 × 16 unframed and 16 × 20 portrait framed mappings, $69 canvas rolls plus $13.49 shipping, digital bundles, later print pricing, one-time Prismatic promotions and corrected economics. It preserves hold-until-redeemed production for the canvas bundle. This document addition does not implement or enable those new commerce paths; the existing physical-product checkout is still the flow described above.
