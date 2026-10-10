# eBay-only canvas and apparel storefronts

The configured seller is **lwvader**. Seller listings: <https://www.ebay.com/sch/i.html?_ssn=lwvader>.

`/canvases.html` and `/apparel.html` retain the original palette, typography and fantasy-city hero. They show only reviewed listings from this seller. Product image, title and purchase links open the item's eBay listing directly in the same tab. The pages do not collect customer details, create orders, take payments, transfer artwork, provide download links or call an ordering API.

The initial catalog contains the item visible in the seller's listings when checked on October 10, 2026:

- **Cute Dancing Banana Canvas | Matte Stretched Wall Art** — <https://www.ebay.com/itm/198704183258>.

No apparel listings were found in that check, so the apparel page shows an empty state and a link to the seller's current listings. No sample products or unrelated seller items are shown.

## Update an existing site without the former physical-order integration

If you never installed the former physical-order update, no Supabase changes, SQL migrations or deletions are needed. Add the canvas/apparel pages, listing JSON, eBay stylesheet, navigation stylesheet and builder/test scripts; replace the existing HTML pages with their updated navigation versions, plus package.json, worker.mjs and sitemap.xml. Keep public/config.js and the existing Stripe webhook unchanged. Your customized homepage and genre HTML are the authoritative versions used by the working build.

The customized-pages ZIP is a narrower patch: it contains your 11 uploaded HTML pages in deployment paths plus public/print-nav.css. The uploaded index(1).html is deployed as public/index.html. It assumes the separate eBay page and supporting files are installed.

## Install the clean replacement build

Use this as a **replacement source build**, not just an overlay. An overlay would leave obsolete physical-order scripts/functions behind. Keep your existing production credentials and hosting settings securely, and keep a backup of the previous project. Do not copy back the retired physical-checkout files. Existing digital artwork purchases, genre collections, Supabase originals, admin tools and verification remain separate and retain their existing behavior.

```powershell
npm.cmd ci
npm.cmd run format:check
npm.cmd run test:portable
```

Deploy the static assets and routing Worker through your existing Cloudflare deployment process. Deploy the included updated digital Stripe webhook. The old physical confirmation URL redirects to the canvas page and offers no download or tracking functionality.

If you deployed the former physical functions, remove them from Supabase:

```powershell
supabase functions delete physical-catalog
supabase functions delete physical-checkout
supabase functions delete physical-order-status
supabase functions deploy stripe-webhook
```

Apply the new `202610100001_retire_physical_checkout.sql` migration if applicable. It works whether or not the former physical tables were created. It removes their payment-claim function and revokes client/service access to those retired tables, preserving historical records. Review any pre-existing paid or pending physical transactions through your merchant dashboards before retiring that workflow. Remove obsolete printing-service credentials from Edge Function secrets. Keep the Stripe/Supabase credentials used by the existing digital-art system. No new eBay secrets, OAuth tokens, SDKs or ordering endpoints are required.

## Add, remove or update listings

The catalog is an explicit, reviewed snapshot, not a live inventory feed. eBay is the source of current price, availability, variants, delivery and returns. No prices or stock claims are duplicated on the studio pages. Refresh the metadata and rebuild when listings change; buyers can always reach the seller's current inventory using the eBay store button.

Edit `public/ebay-listings.json`. Each active entry needs:

- `itemId`: the 12-digit item ID from your own eBay listing.
- `seller`: `lwvader`.
- `category`: `canvas` or `apparel` (includes your listed gifts/accessories).
- `title`: the actual listing title.
- `imageUrl`: the existing public `https://i.ebayimg.com/...` listing preview URL.
- `active`: `true` to show the item, or `false` to hide ended/removed listings.

Verify every new item appears in your seller listings before adding it. Update `verifiedAt` after reviewing the catalog. The builder validates the seller field and URL shapes; it does not independently verify ownership or live availability and makes no external request.

```powershell
npm.cmd run ebay:build
npm.cmd run format:check
npm.cmd run test:portable
```

Deploy the regenerated HTML and updated JSON file. Public previews load from eBay's existing image host; no original or print-ready artwork is fetched or uploaded. The browser does not call Supabase or any order service from these two pages.

## Search and accessibility

Listing cards are rendered into HTML, so they work without JavaScript and are visible to search engines. Both collection pages retain canonical URLs, descriptions, social metadata and `CollectionPage`/`ItemList` structured data. FAQs explain where purchases happen. Native links support keyboards and mobile visitors. No synthetic pricing, stock guarantees or delivery promises are added to structured data.
