# Master comparison and validation

Checked against the two uploaded archives on October 4, 2026.

## Passed

- 23 HTML files parsed, JSON-LD parsed, local links/assets resolved, and 18 sitemap destinations checked. Exactly nine genre query URLs appear in the sitemap.
- Byte comparison preserved the master admin HTML, admin JS, admin dashboard CSS, original shared styles, verifier CSS, and public Supabase configuration.
- JavaScript syntax checks for storefront, catalog core, genre fallback, admin, payment return, and Worker. Ten Supabase TypeScript source files transpiled successfully.
- Actual Chromium desktop and 390 px mobile checks: nine compiled groups, no more than four cards per group, all six fixture works on each full genre page, random refresh, catalog-wide search, keyboard preview dismissal, mobile menu, no horizontal overflow, and no browser page errors.
- Every genre, including Sci-Fi and Dark Fantasy, resolved to its own metadata and full collection. NFT had no checkout buttons.
- Legacy genre/artwork paths and mixed-case query routes reached the expected destination without loops. Unknown paths, unknown genres, and duplicate genre parameters returned 404.
- An unsupported checkout hostname was rejected by the client. Offline catalog tests retained the nine collection links and provided no purchase controls.
- Local PostgreSQL tests executed the actual new migration: Stripe and PayPal fulfillment, duplicate-event handling, unchanged expiration on repeats, mismatch rollback, three-request quota, expiry, and anonymous RPC rejection.
- Mocked Edge Function tests covered canonical return domain, www/apex CORS, unsupported-origin CORS behavior, pending orders without downloads, missing credentials, and invalid methods.

## Read-only live observations

- `https://www.pixelshroomstudio.com/genre.html?genre=fantasy` returned HTTP 307 to `/genre?genre=fantasy`. Both forms are supported by the new Worker, with `.html` retained as canonical under the supplied routing configuration.
- Public artwork and signature-record reads returned HTTP 200.
- `create-checkout`, `order-status`, and `submit-message` preflights returned HTTP 200. The first two accepted the www origin; message intake already allowed public cross-origin submissions.
- The verifier's pinned `@contentauth/c2pa-web@0.15.2/inline?bundle` endpoint returned HTTP 200.

These checks confirm reachability and source/fixture behavior. They do not confirm a paid transaction, a real webhook event, a production SQL migration, actual file delivery, issuer trust, or the validity of a particular signed artwork. Those require staging or post-deployment checks with your existing accounts and files.

`design-preview.png` shows the retained hero and redesigned header from the local browser. Catalog tests used fixtures; the package itself contains no synthetic listings and reads the live published catalog.

## Live homepage correction — October 4, 2026

Live root returned404 while index.html redirected to that failing root. Worker now explicitly requests index.html from ASSETS under html_handling=none. The test binding no longer supplies an implicit index mapping. Validation:22Vitest tests and50desktop/mobile Playwright tests passed; Wrangler deploy dry run passed. Actual local runtime launch was blocked by this environment’s network-interface syscall restriction. See HOMEPAGE-HOTFIX.md for deployment and test:live verification. The fix is packaged, not deployed.
