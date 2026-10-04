# Automated build testing

Use Node.js 24 LTS. From the project root:

```sh
npm ci
npm run test:install-browsers
npm run test:all
```

On Windows PowerShell use `npm.cmd` instead of `npm` if execution policy blocks npm.ps1. All default tests run locally against fixtures. No live checkout, contact message, invitation, upload, or private download is performed.

## Commands

| Command                               | Purpose                                           |
| ------------------------------------- | ------------------------------------------------- |
| npm test                              | Vitest unit and integration checks                |
| npm run test:watch                    | Watch unit tests                                  |
| npm run test:coverage                 | HTML, LCOV and console coverage                   |
| npm run test:e2e                      | Playwright desktop and mobile Chromium            |
| npm run test:e2e:ui                   | Interactive browser test runner                   |
| npm run test:e2e:headed               | Visible browser runner                            |
| npm run test:report                   | Open last HTML report                             |
| npm run test:all                      | Syntax, unit/database coverage and browser checks |
| npx playwright install firefox webkit | Install optional browsers                         |
| npm run test:cross-browser            | Chromium, Firefox and WebKit                      |

`CHROMIUM_EXECUTABLE` optionally selects a preinstalled compatible Chromium binary. Default runs use Playwright's installed browser. Ports 8020 and 8021 must be free. CI installs Chromium and uploads reports even after failure. Cross-browser execution is optional and was not validated in this environment.

## Coverage and limits

- Catalog: exact nine genres, four previews per category, full genre collections, search, escaped content, unsafe URLs, public pagination, empty and offline states, refresh and keyboard preview.
- Routing: canonical host and legacy redirects, valid final destinations, invalid/duplicate genres return404, server-rendered catalog and structured artwork metadata, cache and private-page headers.
- Build/SEO: all local HTML asset and link destinations, indexable canonical pages, descriptions, JSON-LD parsing, nine sitemap genre URLs. Every browser module, Worker and Node signing helper receives a syntax check; every Edge Function receives TypeScript transpilation diagnostics.
- Browser: desktop/mobile layouts, every genre, FAQ/contact/policy/how-it-works/verification/admin/checkout page smoke checks, homepage WCAG A/AA axe audit, contact success/error recovery using mocked responses, incomplete checkout has no visible download. CDN-dependent authenticated admin and verification workflows require the separate integration checks below; a page smoke check does not validate authentication or signature verification.
- Edge contract: canonical return domain, allowed www/apex CORS, foreign-origin rejection, order-status methods/credentials and pending-payment delivery prevention.
- PostgreSQL: real PGlite execution of fulfillment migration against isolated fixture tables, Stripe/PayPal confirmation, duplicate event handling, unchanged expiry on replay, mismatched amount rollback, three-download quota, expiry and anonymous RPC denial.

V8 coverage measures **catalog-core.js and worker.mjs only**. Subprocess database/Edge checks and browser activity are separate and are not included in that percentage. Coverage is not a claim of full build behavior coverage. Reports are generated under coverage/, playwright-report/ and test-results/ and are excluded from the distributable ZIP.

## Remaining integration checks

Before production release use a dedicated staging Supabase project and provider sandbox credentials to test complete Stripe and PayPal webhook signatures, checkout capture/return, paid and expired Storage delivery, admin authentication/authorization/CRUD and uploads, invitations and notifications. Verify a genuine C2PA-signed original, a modified original and a wrong identity key. Run the PowerShell identity/signing/helper scripts on Windows with OpenSSL and c2patool installed. The default suite does not claim these live, platform-dependent flows were executed.

Existing standalone diagnostic scripts remain available in tests/: edge-functions.cjs and payment-database.mjs are invoked by Vitest. browser.cjs/offline.cjs are legacy checks; use Playwright's runner for supported browser reports and CI.

## Actual asset-binding regression checks

`npm run test:runtime` launches the pinned Wrangler/workerd runtime and verifies homepage, nine genre pages, utility/assets, redirects,404,HEAD and unsupported methods against the actual Cloudflare asset binding. It is included in `test:all` and CI. `npm run test:portable` runs syntax, Vitest and Playwright without Wrangler for environments whose sandbox prevents workerd or network-interface inspection.

`npm run test:live` performs read-only GET checks against the production domain after deployment. Override `SITE_TEST_URL` to target staging. It performs no purchases or form submissions. Network failures are failures, not skipped successes.
