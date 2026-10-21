# Secondary marketplace rollout

This update is code and test fixtures, not a live deployment. It adds an internal studio ledger marketplace for existing numbered foil editions, using Stripe Connect destination charges. No blockchain token, gas fee or ownership of copyright is created. The artwork's published nonexclusive personal/commercial permissions remain unchanged. Transfers revoke future site downloads for former holders, but files already downloaded cannot be recalled.

## What is included

- `market_sellers` maps an authenticated member to their Stripe-connected account. The release uses Accounts v1 controller properties with an Express dashboard, Stripe-collected onboarding, platform-paid processing fees and platform responsibility for payment losses. New seller onboarding is **US-only, USD** for this release; it does not silently enable cross-border payments.
- `secondary_market` is the order book. A partial unique index allows only one open listing per mint. The backend checks current ownership, version, paid original issuance, unblocked state and current seller account readiness.
- `market_purchases` snapshots the authenticated buyer, price, currency, destination and 10% fee. The browser cannot choose these authoritative financial values.
- `market_transfers` is an append-only operational audit of sale/refund custody changes. File identities and signed receipts do not change when the registered holder changes.
- A listing enters `preparing` until the Node/Sharp worker creates a permanently watermarked, reduced-size public preview of the actual private variant. The private variant bytes remain unchanged and private. The public feed does not reveal owner email, account IDs or the private artifact path.
- Checkout atomically reserves the active listing before creating the Stripe session. Other buyers cannot start another payable checkout for that edition. The seller cannot cancel or change price while reserved. A cancelled or abandoned checkout stays reserved until Stripe confirms expiry; it is not freed by a client timer.
- Verified Stripe payment fulfillment checks session linkage, amount, currency, application fee and destination, then atomically transfers the mint to the recorded buyer. Duplicate webhooks cannot transfer it twice. The previous primary checkout secret is invalidated and an ownership version prevents old order-secret downloads from reviving after later transfers.
- `/market` redirects to `/market.html`. The feed filters by tier and searches the artwork title/serial. My collection has seller onboarding, a Stripe dashboard link, selling controls, the price/fee quote and open-listing cancellation.

## Fees and expectations

At $50, the gross split is $45 to the seller and a $5 application fee to the platform. **Stripe processing and Connect costs come out of the platform's economics; $5 is not guaranteed net profit.** Payout timing and availability depend on Stripe and seller-account requirements. The UI does not claim immediate bank payment or guaranteed resale value. Very low-priced sales can be unprofitable for the platform after processor costs; review your pricing policy before launch.

## Deployment order

1. Apply the earlier foil-engine and Modal updates first. Back up the database and use a staging Supabase project with Stripe **test** keys. Do not run the generic blueprint SQL supplied in the conversation: it uses incompatible column/table names and lacks the reserved-checkout and access-revocation safeguards.
2. Apply `supabase/migrations/202610190002_secondary_market.sql` once after `202610190001_foil_mint_engine.sql`. It creates the marketplace tables/functions and adds `ownership_version` and `market_frozen` to `mints`. Existing master files, signed mint files, mint numbers, tiers and primary orders are retained.
3. In Stripe, enable and configure your Connect platform for your intended business and seller model. Complete any Stripe platform onboarding/acceptance requirements before enabling real sellers. This code does not grant Connect eligibility or Stripe approval. Destination-charge fees, disputes, refunds and unrecovered negative balances can affect your platform balance.
4. Deploy the Edge Functions below from your normal logged-in/linked Supabase CLI. Keep `MARKETPLACE_ENABLED` false or unset while configuring:

```powershell
npm.cmd ci
npx.cmd supabase functions deploy market-api
npx.cmd supabase functions deploy market-reconcile
npx.cmd supabase functions deploy mint-access
npx.cmd supabase functions deploy stripe-webhook
```

Existing function secrets (`SUPABASE_URL`, service-role key, Stripe secret key and `SITE_URL` where applicable) remain required. Never put service-role or Stripe secret keys in the browser.

5. Configure Stripe webhook destinations:
   - Keep the **platform-account** destination pointing to `/functions/v1/stripe-webhook`, with `STRIPE_WEBHOOK_SECRET`. Include `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `charge.refunded`, `refund.updated`, `charge.dispute.created` and `charge.dispute.closed`.
   - Add a **connected-account** destination for `account.updated`, pointing to the same function URL. Store this destination's separate signing secret as `STRIPE_CONNECT_WEBHOOK_SECRET` in Supabase. The handler verifies either configured secret and ignores unrelated connected-account charge events. Seller status is also retrieved directly from Stripe before listing and checkout, so a stale onboarding return URL never proves readiness.
6. Deploy the updated Modal app. Its worker image installs a font package for protected-preview lettering. The control schedule processes eligible resale previews and invokes the service-only payment reconciliation endpoint every five minutes while there are pending resale purchases or refunds:

```powershell
.\.venv-modal\Scripts\modal.exe deploy modal_mint.py
```

Existing named Modal Secrets and mint-signing keys remain valid. No new signing key is required. Keep the existing Modal wake setup for primary mint payments. Resale previews are picked up by scheduled recovery; settlement itself does not require the image worker.

7. Deploy the storefront with the existing workflow:

```powershell
npx.cmd wrangler deploy
```

8. Enable only the staging marketplace first:

```powershell
npx.cmd supabase secrets set MARKETPLACE_ENABLED=true
```

Test with two distinct member accounts and Stripe test connected accounts. The primary mint and secondary marketplace launch gates are separate. Keep production `MARKETPLACE_ENABLED` false until the checklist below passes. Disabling this gate stops new onboarding/listing/checkout requests; already-paid transfers, status checks, reconciliation and refunds remain operational.

## Staging acceptance checks

1. Mint a ready edition for account A. Connect A's Stripe seller account, complete its hosted onboarding and verify that charges, transfers and payouts are enabled.
2. List A's edition at $50. Confirm the $5 fee/$45 seller quote and wait for the protected actual-variant preview; inspect that the public feed does not return private original or mint URLs.
3. Buy with account B. Attempt a second checkout with C while B's checkout is reserved: it must fail. A cannot cancel a reserved sale.
4. Complete the Stripe test payment. Check that the order book is sold, B owns the same edition and the Connect payment has the expected destination and $5 application fee. B can download the unchanged image and receipt; A's collection and old primary order-secret download no longer grant access. Existing downloaded copies are outside the site's control.
5. Replay the webhook and run reconciliation: no additional transfer, mint or application fee should be created.
6. Test abandoned checkout expiry, onboarding not completed, seller disabled, held mint, direct attempts to change buyer/fee/destination, and a failed/slow database response. Ambiguous database errors return retryable failures; they do not immediately refund a payment that may already have committed its transfer.
7. Test a full refund before the buyer resells, then a refund/dispute after a later resale. See the policies below. Confirm ordinary digital checkout, primary mint delivery and direct eBay purchase links still work.

## Refund, dispute and recovery behavior

A definitive paid inventory conflict is recorded as `refund_pending`, then the service requests a full Stripe refund with both `reverse_transfer=true` and `refund_application_fee=true`, under a stable idempotency key. If Stripe or the database is temporarily unavailable, webhook retry and service reconciliation retry the same operation. Reconciliation pages small batches by the oldest check time; failures do not erase financial records.

For a studio-initiated full refund, an authenticated studio admin can invoke `market-api` with `{ "action":"refund", "purchaseId":"..." }` using their own authenticated session. The API checks the admin marker, freezes the edition for settlement and records the pending refund before contacting Stripe. It is not a seller-controlled refund button. A full refund confirmed by Stripe reverses ledger custody **only if the same buyer and ownership version still hold that edition**. Otherwise the current holder and transfer history are retained and the edition is held for studio review. Partial refunds and disputes also hold the edition for review. A won dispute does not automatically clear an existing hold; the studio must review the actual payment, refund and resale history.

Holds block new listings and new private file URLs. Existing 60-second URLs can remain usable until expiry, and previously downloaded files cannot be revoked. The studio must resolve disputed/resold chains using the recorded transfer audit and actual Stripe financial state. Automated dispute evidence submission, arbitration, negotiated partial refunds and automatic recovery of a negative seller balance are not included. These are operational cases, not a promise that payouts can always be reversed.

Pending purchases with no stored session are reconciled by searching Stripe's sessions for their server-issued purchase metadata. If no session was created at all, they remain held for studio review: only release after confirming no payable provider session exists. A network timeout alone does not prove this. For stuck preview generation, examine worker logs; a seller can cancel an unreserved `preparing` listing and relist after the source problem is corrected. A studio operator can also retry a failed preview through service-side SQL after checking the source hash.

For an exceptional hold resolution, use a privileged database transaction to lock the mint, examine every related purchase/transfer and Stripe record, cancel any stale open listings, and record the studio's decision in your support/audit records before clearing `market_frozen`. Do not overwrite `owner_id` to reverse a historical sale without accounting for subsequent paid holders.

## Tests and remaining external requirements

`npm.cmd run test:coverage` includes SQL tests for duplicate listings, exclusive checkout reservations, mismatched amounts/fees/destinations, webhook replay, former-owner credential revocation, refund reversal and resale-chain freezes. Rendering tests exercise protected public derivatives and unchanged private bytes. `npm.cmd run test:e2e` covers the market feed, filters, seller quote, checkout redirect, confirmation states and existing storefront flows. Fixture tests do not onboard a real Stripe seller, settle a real destination charge, deploy Modal, or validate every jurisdiction's marketplace obligations. Those require your configured account and staging acceptance run.

Official references: https://docs.stripe.com/connect/destination-charges.md?platform=web&ui=stripe-hosted , https://docs.stripe.com/connect/migrate-to-controller-properties , https://docs.stripe.com/connect/express-accounts , https://docs.stripe.com/api/refunds/create .

### Package validation

The update passed 92 desktop/mobile Playwright tests, the 61-test unit suite plus the added endpoint authorization test (62 unit tests in total), five Modal adapter tests, JavaScript syntax checks, Prettier and the Cloudflare deployment dry run. Financial tests use fixtures and local PostgreSQL-compatible SQL execution; they do not establish live Stripe Connect eligibility or real payout behavior. The local Cloudflare runtime check could not start in this execution environment because `uv_interface_addresses` was blocked. Run `npm.cmd run test:runtime` on your development machine or CI before production activation.

## Current testing-branch package

This refreshed package uses the latest six-tier renderer and explicit post-reveal profile flow. Apply it over the current foil-engine build, preserving your existing secrets and signing keys. It includes the renderer's local dependencies to prevent missing-module errors.

Apply pending migrations in numeric order: `202610190001` (existing prerequisite), `202610190002`, `202610190003`, then `202610190004`. Do not rerun migrations already recorded as applied. The profile migration depends on the marketplace's ownership/hold columns. Follow `docs/PAID-REVEAL-PROFILE-UPDATE.md` for the separate add-to-profile action.

For primary purchases: choose artwork → pay → verified payment → secure allocation and concealed opening → image revealed → Add to my collection. Secondary sales transfer the same existing edition and tier; they do not reroll, generate a new mint, or change its signed file. Use two different accounts for the seller and buyer during testing.

Start the local demo with `npm.cmd run demo`, then open the address printed in the terminal. Use **My collection / sell** to test the price dialog and **Marketplace / buy** to test resale checkout and confirmation. This demo simulates payments and seller readiness; the staging checklist above is still required to exercise actual Stripe test-mode onboarding and webhooks.

Current validation: 66 unit/integration tests, 102 desktop/mobile browser tests, and the six-tier local demo pass. The marketplace is implemented but has not been deployed or activated in your account by this update.
