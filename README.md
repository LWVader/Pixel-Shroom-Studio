# Pixel Shroom Studio — checked master-site update

This package merges the redesign with the uploaded Pixel-Shroom-Studio master. It retains the forest-green, cream, gold, and cyan palette, the original fantasy-city hero, the existing public Supabase configuration, the original admin screens, and the cryptographic verifier. It has not been deployed to the live site.

## Required installation

Merge this package into your existing project. Keep your existing local secrets, signing identity, environment settings, and dependency installation. The package deliberately does not include private credentials, signing keys, Git history, or node_modules. The uploaded master remains your backup. The original setup/signing instructions are retained in `docs/MASTER-README.md`.

Deploy only the `public/` directory as static assets, using the supplied routing Worker. Never deploy the project root as a public directory.

1. Apply only the new `supabase/migrations/202610040001_payment_fulfillment_and_downloads.sql` in Supabase SQL Editor, after your existing schema/migrations. It adds the service-only fulfillment and download RPCs required by this update. It does not delete tables, orders, or license records. It uses new RPC names to avoid conflicting with manually installed older functions.
2. Deploy the updated Edge Functions listed below. Your existing Supabase secrets remain necessary; do not put them in `public/config.js`. Set `SITE_URL` to `https://www.pixelshroomstudio.com` for production. The shared code also normalizes the known old production aliases to this URL, and supports the canonical www and apex origins for browser API requests.
3. Merge `worker.mjs` and the `assets` settings from `wrangler.jsonc` into your existing Cloudflare Worker configuration. Retain your actual existing Worker name, account settings, custom-domain routes, and other bindings. The sample name is `pixel-shroom-studio`; confirm it matches the Worker you already deploy.
4. The routing settings must include `binding: "ASSETS"`, `run_worker_first: true`, and `html_handling: "none"`. The Worker is essential for server-readable query-string genre pages and stable `.html` URLs. Uploading static files alone gives a JavaScript fallback, but not the same server-rendered genre metadata or redirect handling.
5. Deploy through your existing GitHub/Cloudflare workflow, or use your existing Wrangler deployment command. In PowerShell, use `npx.cmd` / `npm.cmd` if `.ps1` execution is blocked. For local routing checks, `npm.cmd run dev:worker` starts Wrangler through npx.
6. After deployment, check one Stripe test payment, one PayPal sandbox/test payment, the payment return page, the private download, the contact form, admin access, and one known signed artwork. Submit `/sitemap.xml` to Google Search Console and Bing Webmaster Tools.

Deploy these functions after applying the new SQL:

```powershell
npx.cmd supabase functions deploy create-checkout --no-verify-jwt
npx.cmd supabase functions deploy order-status --no-verify-jwt
npx.cmd supabase functions deploy paypal-capture --no-verify-jwt
npx.cmd supabase functions deploy paypal-webhook --no-verify-jwt
npx.cmd supabase functions deploy stripe-webhook --no-verify-jwt
npx.cmd supabase functions deploy download-original --no-verify-jwt
npx.cmd supabase functions deploy submit-message --no-verify-jwt
npx.cmd supabase functions deploy add-admin-user --no-verify-jwt
```

The admin-invitation function still verifies the caller's bearer token and admin membership in its handler. Webhooks verify provider signatures; turning off the gateway JWT requirement does not disable those checks. Deploy every listed function that imports the changed shared helper, including the webhook and download functions.

## Exactly the requested navigation

| Label | Public destination |
| --- | --- |
| All artwork | `https://www.pixelshroomstudio.com/#gallery` |
| Portrait | `/genre.html?genre=portrait` |
| Fantasy | `/genre.html?genre=fantasy` |
| Landscape | `/genre.html?genre=landscape` |
| Sci-Fi | `/genre.html?genre=sci-fi` |
| Abstract | `/genre.html?genre=abstract` |
| Dreamscape | `/genre.html?genre=dreamscape` |
| Dark Fantasy | `/genre.html?genre=dark-fantasy` |
| Horror | `/genre.html?genre=horror` |
| NFT | `/genre.html?genre=nft` |
| FAQ | `/faq.html` |

These are the only genre categories. Utility pages such as contact, verification, admin, and payment confirmation remain available.

All artwork is the compiled gallery on the homepage. Each genre gets up to four randomly sampled published previews, without duplicates within a group, and a “Take me to [genre]” link. A “Show another selection” button refreshes the sample. Search covers the entire loaded published catalog before selecting up to four matches per category. A full genre page shows every published listing in that genre, rather than stopping at four. If fewer than four works exist, only the available works are shown. Empty genres show their collection link and an honest empty state. NFT previews may be displayed, but NFT purchase actions are disabled and new NFT checkout requests are rejected until releases are enabled deliberately.

`public/genres/*.html` are internal HTML assets for the nine query-string pages. Direct visits to those paths redirect to the associated `/genre.html?genre=...` URL. They are not additional public genre categories.

## Connection and redirect fixes

- Canonical URLs and social/sitemap metadata use `https://www.pixelshroomstudio.com`, replacing the earlier redesign's workers.dev domain.
- The master currently redirects `.html` requests to extensionless URLs. The update explicitly handles `/genre?genre=...` and `/genre.html?genre=...`, preserving the query and avoiding loops when deployed with the supplied HTML handling settings.
- Legacy `/genre/fantasy` and the earlier redesign's `/genres/fantasy.html` redirect permanently to `/genre.html?genre=fantasy`. `/artwork`, `/artwork.html`, and `/all-artwork.html` redirect to `/#gallery`.
- Apex and the known old workers.dev hostname redirect to www. Query parameters, including payment-return credentials, are preserved through these hostname redirects. Unknown or duplicate genre parameters return a genuine 404.
- The original Supabase URL and anonymous key are retained. Public artwork requests explicitly select preview fields and never request `original_path`, orders, or private originals.
- Catalog pagination no longer stops at the master homepage's six-record limit. Journal errors do not prevent catalog loading.
- The Worker renders live public previews into HTML for search engines and JavaScript-disabled readers. The browser uses that same server sample, then enables checkout controls. Server-side catalog data is cached in memory for up to 60 seconds; checkout always re-reads the published artwork and price on the backend.
- Both Stripe and PayPal checkout are connected to the existing `create-checkout` contract. IDs are passed without coercion. Provider URLs are checked against HTTPS Stripe/PayPal hostnames before navigation.
- The master called fulfillment/download RPCs whose definitions were absent from the uploaded migrations. This update supplies `fulfill_stripe_checkout_verified`, `fulfill_verified_order`, and `consume_verified_download`, and updates the server callers.
- Payment event recording, paid state, and license creation commit atomically. Duplicate webhooks do not reset license expiration. Amount, currency, provider, and provider reference must match the local order. These RPCs are executable only by `service_role`.
- PayPal webhook processing now returns a retryable failure if database fulfillment fails. The earlier code recorded the event before its separate fulfillment operations, which could prevent a failed event from being fulfilled on retry.
- Download authorization still checks the private buyer token, paid state, license expiry, and count before returning a 60-second private Storage redirect. The master license policy remains 24 hours and three authorized download-link requests. A signed Storage URL can be reused within its 60-second lifetime; the count limits link issuance, not each Storage GET.
- The verifier's pinned C2PA SDK and DOM IDs are retained. The CSP permits the existing esm.sh SDK, WebAssembly, and public HTTPS preview images.
- Admin HTML, admin JavaScript, admin CSS, legacy shared CSS, and public configuration were checked byte-for-byte against the master and preserved. New storefront styling lives in `storefront.css` so it does not restyle the admin, verifier, or payment screens.
- Payment return pages are not indexed, use no-store caching, and the success page uses no-referrer. The returned delivery URL is checked before it is displayed.

## SEO, GEO, SXO, AEO

SEO: server-readable unique genre titles/descriptions, canonical query URLs, XML sitemap, robots controls, social metadata, appropriate image dimensions and alt text, local responsive WebP hero, and stable internal links.

GEO and AEO: readable genre definitions, concise buyer answers derived from the master FAQ, explicit studio/artist identity, matching FAQ/Breadcrumb/Organization/WebPage structured data, and VisualArtwork metadata for rendered previews. No invented ratings, sales inventory, or unsupported trusted-issuer claims. There is no guarantee of rankings, AI citations, or rich results.

SXO: full collections beyond the four-work sampler, global and genre search, clear usage and payment guidance, accessible focus/skip links, keyboard-dismissable image previews, mobile navigation, reduced-motion support, and explicit unavailable/coming-soon states.

Relevant primary guidance:
- https://developers.google.com/search/docs/appearance/ai-features
- https://developers.google.com/search/docs/fundamentals/ai-optimization-guide
- https://developers.cloudflare.com/workers/static-assets/redirects/
- https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/
- https://opensource.contentauthenticity.org/docs/sdk-repos/c2pa-js/packages/c2pa-web/

## Validation and limits

See `docs/AUDIT.md` for results. Automated checks use synthetic fixtures and a local PostgreSQL engine; no live purchase, invitation, message, or database modification was performed. Real billing, webhook delivery, private Storage delivery, and validation of a known signed original require the post-deployment test above. Applying the SQL and routing/backend updates is necessary; this is not a CSS-only patch.
