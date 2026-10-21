# Gelato physical products — replacement for the eBay storefront

This update replaces the active canvas/apparel shopping pages, homepage product examples, public feed, FAQ and physical-purchase wording. Digital original purchases, numbered editions, collection reveals, marketplace payments, signing keys and the Modal mint processor retain their existing paths. Do not replace your live digital Stripe credentials to test this integration.

The initial physical checkout supports **US delivery, USD, one mapped product variation per checkout and quantities 1–10**. Each apparel size/color or canvas size is its own mapping to an exact Gelato product UID. It does not guess UIDs or create an entire Gelato catalog automatically. Other products and countries require appropriate mappings and address/tax validation before expanding checkout.

## Installation

1. Replace the files supplied in the update, preserving their folders. The new migration follows the existing studio migrations: `supabase/migrations/202610210002_gelato_print_orders.sql`.
2. Apply pending migrations to your correctly linked Supabase project:

   ```powershell
   npx.cmd supabase db push
   ```

   You can instead run the new SQL in Supabase SQL Editor after all earlier required migrations are installed. This creates separate private product, quote, order and event tables plus the private `gelato-print-files` bucket. It does not clear artwork, import eBay listings or create a Gelato order.

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
- The old `/api/ebay-listings` route returns 410 and no longer calls eBay. Legacy source helpers/tests and historical records may remain for compatibility; no active storefront calls or links use them. Old eBay secrets are not needed by the Gelato flow.

## Useful references

- API authentication: https://dashboard.gelato.com/docs/
- Order quote: https://dashboard.gelato.com/docs/orders/v4/quote/
- Order create / draft: https://dashboard.gelato.com/docs/orders/v4/create/
- Get/Search: https://dashboard.gelato.com/docs/orders/v4/get/ and https://dashboard.gelato.com/docs/orders/v4/search/
- Product mapping: https://support.gelato.com/en/articles/8996102
- PDF design requirements: https://support.gelato.com/en/articles/8996349 (use product-specific guidance as well)
- Stripe Tax with Checkout: https://docs.stripe.com/tax/checkout/page

Run `npm.cmd run check`, `npm.cmd test`, `npm.cmd run prints:check`, `npm.cmd run test:e2e`, and `npm.cmd run demo:test`. The existing demo remains a digital edition/reveal demo; physical sandbox testing uses mapped Gelato products and separate test credentials as described above.
