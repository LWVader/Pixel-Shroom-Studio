> Follow-up implementation: see [FORGE-PRINT-LOOP-INSTALL.md](FORGE-PRINT-LOOP-INSTALL.md) for the transactional roll, Forge and print-claim update. Preview-only statements below describe the earlier layout release.

# Forge & Print storefront restructure

This update implements the public layout and connected browsing experience from the supplied outline. It preserves the existing Georgia font, green/cream/gold palette, hero image, protected previews, nine genre pages, newest-14 homepage, current payments and automatic concealed reveal. It does not implement or activate the new $8/$69 checkouts, bundles, Forge consumption or physical entitlements described in `CANVAS-DIGITAL-FORGE-WORKFLOW.md`.

## What changes

- Consistent global navigation: Explore Gallery, The Forge, How It Works, Drop Odds and Verify Serial. My Vault links to the existing private collection. Cart stores planned offer selections on this browser. One global search searches all published titles, genres and serials; search results are not limited to four previews per genre.
- Homepage: existing hero imagery with a clearer hook, three-step loop, studio provenance, latest 14 artworks, interactive tier/finish guide, Forge teaser, featured selections, real product examples, creator introduction and existing opt-in/contact paths. Empty journal/feedback sections remain hidden. The nine genres retain their existing routes; no new genre is invented.
- Artwork cards: protected preview, linked title, source serial/dimensions, two planned roll paths and the existing actual purchase controls. Preview prices are explicitly distinguished from current listing prices.
- `/art.html?id=ID`: server-rendered individual artwork page with metadata/canonical ID, large protected image, illustrative finish selector, planned canvas/digital/bundle options and accurate before-tax totals. Existing purchase controls retain their own displayed price and backend paths. The format illustration is not a manufacturing proof.
- `/drop-odds.html`: interactive six-tier guide, complete offer comparison, guarantee disclosure and distinction between proposed base odds and existing edition caps.
- `/forge.html`: all five recipes and a working quantity calculator. Nothing is consumed. It explains same-artwork inputs, whole outputs, retired records versus downloaded files, and separate print pricing.
- `/canvas-specs.html`: 16 × 16 unframed / 16 × 24 portrait framed mappings, later print prices, US-only planned delivery, one-time claim conditions and resolution/template requirements.
- `/cart.html`: persistent local planned selections, reviewed artwork availability, fixed display prices and removal. No payment, stock reservation or real order is created. It is noindex/no-store. No customer, address, payment or authentication data is saved in this cart.
- Footer: studio/story/contact, mechanics, product specifications, real account/order links, verification and legal information. Journal navigation appears on the homepage only when published content exists.
- FAQ visible answers and JSON-LD agree. New guides are in the sitemap and `llms.txt`; individual artwork canonical pages use `VisualArtwork` schema without advertising unlaunched Offers.

## Accuracy changes from the outline

There are no on-chain rolls, publicly verified fairness proofs, museum-quality guarantees, 1-of-1 claims, foil embossing promises or blanket 3–5-day shipping estimates. Registered file size/format is shown when known; a 4K PNG master is not promised for every existing listing. Dark wood is not called walnut without an exact verified specification. Gold and above have 20% combined base odds of a physical format upgrade; Silver shares Standard's slim format. A digital Forge upgrade does not automatically include a free physical product. A digital reveal does not imply that a Gelato order exists.

The payment-confirmed automatic continuous reveal remains the tested interaction. No extra required “Tap to Reveal” step or second spin is introduced. Existing Add to my collection behavior still saves the edition and initiates image/receipt downloads.

## Installation

Replace all supplied files preserving their folders. Build and deploy with the project's existing Cloudflare process:

```powershell
npm.cmd run format:check
npm.cmd test
npm.cmd run build
npx.cmd wrangler deploy
```

The header's optional authenticated Vault count uses the updated `mint-access` function:

```powershell
npx.cmd supabase functions deploy mint-access
```

No new SQL migration, credentials or package dependencies are required by this layout update. Keep the prior Gelato/preflight setup where already installed. If the count function is not deployed, the header safely omits the count rather than inventing a balance. The count covers saved, ready, unfrozen digital editions with paid source orders; it is not a claim of Forge/print eligibility. Guest users see My Vault without a fictional owned count. `/vault` redirects to `/collection.html`; existing routes and `/artwork.html` legacy redirects remain intact.

The new commerce model still requires its separately specified backend implementation and tests before paid offer activation. A browser cart or displayed price never authorizes changing an existing checkout amount. No paid order, production submission or live deployment was performed while preparing this update.

## Browser test timing

The post-payment reveal assertion allows 15 seconds for existing payment polling, image decode and the roughly four-second deceleration to finish. The animation itself is unchanged. The multi-page provenance/accessibility test and the full mobile owner preflight workflow use Playwright's slow-test budget; their individual assertions and ownership/payment checks are retained.
