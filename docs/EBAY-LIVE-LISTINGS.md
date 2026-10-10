# Live eBay listings

Deploy the updated Worker together with the public files. Both pages retrieve public listing previews from eBay Browse search, restricted to seller **lwvader** and the US marketplace. There are no order calls, artwork uploads or download links.

## Required configuration

Create production app keys in the eBay Developers Program and confirm your application has production Browse API access. eBay may require approval for production Buy APIs. Sandbox keys do not show your real store.

Set these Cloudflare Worker secrets locally (never put keys in HTML, public/config.js or Git):

```powershell
npx.cmd wrangler secret put EBAY_CLIENT_ID
npx.cmd wrangler secret put EBAY_CLIENT_SECRET
npx.cmd wrangler deploy
```

OAuth uses an application token with the public `api_scope`. No customer or seller account login is needed. This is read-only product discovery; the only POST is application authorization, never an order or image upload.

Open `/api/ebay-listings`: a configured deployment returns 200 and the public catalog; missing credentials or denied/unavailable eBay access returns 503 with a generic message. Do not share secrets when troubleshooting.

## Refresh and category rules

The Worker caches a complete result for five minutes and renders current cards and ItemList schema into both HTML pages for crawlers and visitors without JavaScript. Visible browser pages refresh on load, every five minutes, and when reopened after being hidden. Updates appear after eBay search indexes them, plus the cache/refresh interval; synchronization is not instantaneous. Failed refreshes remove cards and provide a direct store link.

Search matches canvas, shirt, tee, hoodie, sweatshirt, mug, tote, bag, hat, cap, gift and apparel terms. Titles containing canvas go to Canvases; other matching apparel/gift titles go to Apparel & gifts. Unrelated products are omitted. Use these product words in listing titles. If you add a different product type, extend both the search terms and categoryFor in ebay-feed.mjs. Pages deduplicate variations by listing ID; eBay displays options, prices, availability and shipping. No prices are cached here. Only public eBay preview URLs are shown.

Browse search has a 10,000-result window. Larger inventories or incomplete/error responses produce the store-link fallback instead of a misleading partial catalog. Pending requests share one refresh per Worker isolate; application tokens are reused until expiry. Busy deployments can have multiple isolates, so monitor eBay quotas.

`npm.cmd run ebay:build` validates the live templates; it no longer copies the old ebay-listings.json snapshot into production pages. That snapshot is retained only as test/example data. No Supabase migrations or digital checkout changes are required.

## Tests

```powershell
npm.cmd ci
npm.cmd run format:check
npm.cmd run test:coverage
npm.cmd run test:e2e
```

Tests use local fixtures rather than production credentials. Unit tests cover seller isolation, preview validation, pagination, caching, token refresh, failure handling and server-rendered schema. Browser tests cover both viewports, live additions/removals, empty/error states, accessibility and direct eBay destinations.

Official documentation:

- https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search
- https://developer.ebay.com/api-docs/buy/static/ref-buy-browse-filters.html
- https://developer.ebay.com/api-docs/static/oauth-client-credentials-grant.html
- https://developer.ebay.com/api-docs/buy/static/buy-requirements.html
