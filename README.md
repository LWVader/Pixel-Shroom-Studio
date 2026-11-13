# Pixel Shroom Studio — checked master-site update

This package merges the redesign with the uploaded Pixel-Shroom-Studio master. It retains the forest-green, cream, gold, and cyan palette, the original fantasy-city hero, the existing public Supabase configuration, the original admin screens, and the cryptographic verifier. It has not been deployed to the live site.

## Install or reset the storefront

Follow [Clean start](docs/CLEAN-START.md) for the Supabase migrations, Cloudflare deployment, and test-data reset. Apply the numbered migrations in order; keep your existing provider secrets, signing identity, and Cloudflare routes. The Worker serves the generated `dist/public` assets. If a local checkout already has dependencies, use `npm ci` to sync them to the supplied lockfile.

## Exactly the requested navigation

| Label        | Public destination                                   |
| ------------ | ---------------------------------------------------- |
| All artwork  | `https://www.pixelshroomstudio.com/all-artwork.html` |
| Portrait     | `/genre.html?genre=portrait`                         |
| Fantasy      | `/genre.html?genre=fantasy`                          |
| Landscape    | `/genre.html?genre=landscape`                        |
| Sci-Fi       | `/genre.html?genre=sci-fi`                           |
| Abstract     | `/genre.html?genre=abstract`                         |
| Dreamscape   | `/genre.html?genre=dreamscape`                       |
| Dark Fantasy | `/genre.html?genre=dark-fantasy`                     |
| Horror       | `/genre.html?genre=horror`                           |
| NFT          | `/genre.html?genre=nft`                              |
| FAQ          | `/faq.html`                                          |

These are the only genre categories. Utility pages such as contact, verification, admin, and payment confirmation remain available.

The homepage displays the 14 newest published artworks across all genres, ordered by creation time. All artwork is the separate compiled gallery at `/all-artwork.html`. Each genre gets up to four randomly sampled published previews, without duplicates within a group, and a “Take me to [genre]” link. A “Show another selection” button refreshes the sample. A full genre page shows every published listing in that genre, rather than stopping at four. If fewer than four works exist, only the available works are shown. Empty genres show their collection link and an honest empty state. NFT previews may be displayed, but NFT purchase actions are disabled and new NFT checkout requests are rejected until releases are enabled deliberately.

`public/genres/*.html` are internal HTML assets for the nine query-string pages. Direct visits to those paths redirect to the associated `/genre.html?genre=...` URL. They are not additional public genre categories.

## Connection and redirect fixes

- Canonical URLs and social/sitemap metadata use `https://www.pixelshroomstudio.com`, replacing the earlier redesign's workers.dev domain.
- The master currently redirects `.html` requests to extensionless URLs. The update explicitly handles `/genre?genre=...` and `/genre.html?genre=...`, preserving the query and avoiding loops when deployed with the supplied HTML handling settings.
- Legacy `/genre/fantasy` and the earlier redesign's `/genres/fantasy.html` redirect permanently to `/genre.html?genre=fantasy`. `/artwork` and `/artwork.html` redirect to `/all-artwork.html`; `/all-artwork.html` serves the collection page directly.
- Apex and the known old workers.dev hostname redirect to www. Query parameters, including payment-return credentials, are preserved through these hostname redirects. Unknown or duplicate genre parameters return a genuine 404.
- The original Supabase URL and anonymous key are retained. Public artwork requests explicitly select preview fields and never request `original_path`, orders, or private originals.
- Catalog pagination no longer stops at the master homepage's six-record limit. Journal errors do not prevent catalog loading.
- The Worker renders live public previews into HTML for search engines and JavaScript-disabled readers. The browser uses that same server sample, then enables checkout controls. Server-side catalog data is cached in memory for up to 60 seconds; checkout always re-reads the published artwork and price on the backend.
- Stripe checkout are connected to the existing `create-checkout` contract. IDs are passed without coercion. Provider URLs are checked against HTTPS Stripe hostnames before navigation.
- The master called fulfillment/download RPCs whose definitions were absent from the uploaded migrations. This update supplies `fulfill_stripe_checkout_verified`, `fulfill_verified_order`, and `consume_verified_download`, and updates the server callers.
- Payment event recording, paid state, and license creation commit atomically. Duplicate webhooks do not reset license expiration. Amount, currency, provider, and provider reference must match the local order. These RPCs are executable only by `service_role`.
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

## Automated testing

Playwright and Vitest are installed with locked dependency versions. Run `npm ci`, `npm run test:install-browsers`, then `npm run test:all`. See [docs/TESTING.md](docs/TESTING.md) for scope, reports, Windows commands and remaining staging checks.

## Readable source formatting

HTML, CSS, JavaScript, TypeScript, test files and configuration use consistent two-space indentation. Run `npm.cmd run format` to format changes, or `npm.cmd run format:check` to check formatting. On other platforms use `npm` instead of `npm.cmd`. EditorConfig and Prettier settings keep source readable across editors. Public asset files and generated reports are excluded.
