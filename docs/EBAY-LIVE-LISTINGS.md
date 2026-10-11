# Auth’n’Auth setup (no OAuth refresh token)

In Cloudflare Workers & Pages → your Worker → Settings → Variables and Secrets, add **EBAY_AUTH_TOKEN** as type **Secret**. Use the production Auth’n’Auth token for lwvader, not an OAuth access token. Deploy the updated ebay-feed.mjs. This token takes precedence if OAuth secrets are also configured; no refresh token or Dev ID is required for these read calls. Existing app secrets may remain.

The endpoint should return authentication: "auth-n-auth" and source: "seller-active-listings". The account token is sent only to eBay in XML RequesterCredentials, escaped correctly, and never returned to browsers. GetUser verifies the account; GetMyeBaySelling retrieves every active-listing page. New listings and ended listings update every five minutes. No fixed item IDs, public search, orders or artwork uploads are used. You must replace the legacy token if it expires or is revoked; it is not renewed through OAuth. This change does not guarantee success until tested with your production token.

Replace ebay-feed.mjs for production. The ZIP also contains updated tests and this guide. The fast-xml-parser dependency from the seller-sync update is still required; run npm.cmd ci if it has not been installed. Existing HTML, images and keys need no changes.

## Optional OAuth configuration

# Automatic seller listing feed

The shop now reads the authenticated **lwvader** account's active listings using eBay Trading API GetMyeBaySelling. It does not use Browse search, title-based discovery, scraped eBay pages or a list of hard-coded item IDs. Every refresh fetches all pages of the active collection and replaces the previous catalog. The Worker verifies the authorized seller with GetUser before exposing any listings.

## Install and configure

Replace the files in this update, preserving paths, then install the XML parser dependency:

```powershell
npm.cmd ci
```

Keep the existing EBAY_CLIENT_ID and EBAY_CLIENT_SECRET Worker secrets. Add **EBAY_REFRESH_TOKEN** with the production OAuth refresh token for lwvader, issued to the same production application keyset. It must include the base scope https://api.ebay.com/oauth/api_scope. No customer login is needed; this is your seller account's authorization.

In Cloudflare, open Workers & Pages → your Worker → Settings → Variables and Secrets → Add. Choose **Secret**, name it EBAY_REFRESH_TOKEN, paste its value, and deploy. Do not put the token in public/config.js, HTML, Git, ordinary text variables or chat. Alternatively:

```powershell
npx.cmd wrangler secret put EBAY_REFRESH_TOKEN
npx.cmd wrangler deploy
```

Deploy the updated code through your usual Git-connected build or Wrangler. A dashboard secret update alone does not upload the code. Your build must install package.json/package-lock.json dependencies before bundling.

## Verify

Open `/api/ebay-listings`. A configured deployment returns 200 with `source: "seller-active-listings"`, `activeListingCount`, `updatedAt`, and public preview metadata in `items`. It no longer returns supplementalChecks. A 503 means credentials, seller identity, authorization or the upstream inventory request failed. Inspect Worker logs without printing keys, tokens, raw XML or buyer/account data. This build does not automatically fall back to incomplete public searches.

Live authorization cannot be validated by local fixture tests. A sandbox refresh token, token for another seller, revoked token or token issued under another app keyset will not work. Access tokens renew automatically; if the refresh token is revoked or expires, replace that secret after reauthorization.

## Refresh and classification

Listings update on page load, every five minutes while a page is visible, and when returning to a hidden page. The Worker caches a successful complete catalog for five minutes, so changes are periodic rather than instantaneous. New listings are discovered automatically through the seller collection without manual IDs or dependence on public search indexing. Ended listings disappear when absent from the next active collection. Listings explicitly reporting zero available quantity or past end dates are omitted.

Titles containing the word canvas or canvases appear on Canvases. All other active products appear on Apparel & gifts, so missing product words cannot silently discard a new design. This suits the studio's canvas/apparel/gift catalog; use canvas in canvas listing titles to route them correctly. GetMyeBaySelling's active-list response does not supply the complete category hierarchy. No per-item lookup is used to classify listings. Invalid or non-eBay preview images cannot be displayed; activeListingCount can therefore exceed the number of displayed items.

Product links go directly to eBay. eBay handles prices, variations, payment, shipping and order support. Only public eBay preview metadata is returned to browsers. Both pages retain their design, hero image and custom-print contact notice. Server-rendered cards and ItemList schema stay aligned with the current feed. No artwork uploads, original downloads, order creation or listing changes are performed.

The Trading API uses HTTP POST for its read operations. This integration only issues GetUser and GetMyeBaySelling plus OAuth token renewal; POST does not mean an order is being submitted. Sold, unsold and scheduled collections, private notes and selling summaries are explicitly excluded. Output selectors request only listing IDs, titles, public preview URLs, quantity, end dates and pagination metadata; account verification requests only UserID.

## Limits and reliability

The API has a 25,000-item limit. This implementation rejects catalogs at that boundary rather than silently publish a truncated result. Pagination inconsistencies, duplicate IDs, errors and incomplete responses fail the refresh and leave a direct-store fallback. A changing inventory can produce a transient failure during pagination; the next browser refresh retries. One refresh per Worker isolate is shared by concurrent requests. Monitor your eBay quotas on busy deployments. Local tests use fixtures; they do not consume production credentials.

```powershell
npm.cmd run format:check
npm.cmd run test:coverage
npm.cmd run test:e2e
```

Official documentation:

- https://developer.ebay.com/devzone/xml/docs/reference/ebay/getmyebayselling.html
- https://developer.ebay.com/devzone/xml/docs/reference/ebay/GetUser.html
- https://developer.ebay.com/develop/guides/sell/authorization
- https://developer.ebay.com/api-docs/user-guides/static/make-a-call/using-xml.html

## Safe failure diagnostics

A failed /api/ebay-listings request now includes diagnostic: version, stage, fixed error code, numeric eBay error codes or HTTP status, authentication mode and booleans indicating which secrets exist. These details are also logged to Worker logs. It never returns token values, raw XML, provider error descriptions, account details or client secrets. Send the diagnostic object when reporting a failure. This update identifies failures; it does not assume token renewal was the cause.
