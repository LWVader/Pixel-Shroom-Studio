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

Open Admin → **Gelato** → Refresh products & orders.

In Admin → Images, upload the six finished tier images once. Artist defaults to **LWVader** and roll prices remain central. Admin → Gelato has no Product template settings / technical-check panel.

Choose the artwork, tier and physical frame, then enter the exact Gelato product UID and click **Load Gelato product**. A server-side GET reads the supplier’s catalog attributes, checks printability and US support, and rejects known size/frame/thickness mismatches. No artwork or order is sent to Gelato during product loading. The API key stays on the server. Unknown attributes are displayed without being certified or invented.

Current physical formats:

| Tier                     | Canvas                  | Frame                              |
| ------------------------ | ----------------------- | ---------------------------------- |
| Standard / Silver / Gold | 16 × 16 thick canvas    | Unframed                           |
| Emerald / Sapphire       | 16 × 24 portrait canvas | Choose Black, Natural or Dark Wood |
| Prismatic                | 24 × 24 canvas          | Choose Black, Natural or Dark Wood |

Browse site artwork or choose a PNG/JPEG from your computer. Position the image using dragging, corner handles, zoom or sliders. Preview canvas opens front, angled and wall views with the selected finish. These studio mockups are illustrative; the loaded catalog data identifies the actual Gelato product. Saved product cards let you reload and preview a prepared product before fulfillment.

Save image position prepares the private print file and protected preview automatically. Its source association, crop and hashes remain recorded; source pixels and output bytes are validated automatically without a manual review form. Publishing saves the mapped product to the studio catalog after confirmation. Gelato fulfillment happens only after paid checkout or prepaid redemption.

Frame choice requires 12 current mappings per artwork: one unframed mapping for each of Standard/Silver/Gold, plus Black/Natural/Dark Wood mappings for each of Emerald/Sapphire/Prismatic. Every physical finish must use its own exact product UID. The new checkout guard opens canvas rolls only when all 12 current mappings are active and ready. Existing later-print prices and fixed roll prices are unchanged; supplier quotes still apply and no margin estimate is invented for the larger canvas.

Apply `202610240001_canvas_frame_choices.sql`, deploy `print-api`, then build/deploy the storefront. It versions mappings rather than overwriting earlier promised products. Previously paid orders and prepaid claims retain their original product version. New-format products coexist with legacy mappings; the Vault shows the correct version and available frame options for the purchase. Earlier independent physical listings are closed to new orders, while existing paid fulfillment remains intact.

The product lookup uses Gelato’s documented read-only endpoint: https://dashboard.gelato.com/docs/products/product/get/ . It is separate from the order submission API.

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

## Current rollout

Run `supabase db push --dry-run`, then `supabase db push` to apply the new frame/version migration. Deploy `print-api`, build and deploy the storefront, then configure the 12 current-format mappings per artwork before opening canvas rolls. This keeps old paid commitments separate from new product promises. Existing payment keys and Gelato secrets are reused.

The corrected formats use canvas mapping version 3. Republish the 12 mappings per artwork using the correct UIDs and dedicated 16 × 24 portrait compositions for Emerald and Sapphire. Earlier paid-order mappings remain unchanged.
