# Buying animation and server-side rarity

The opening starts immediately when an authenticated buyer clicks the primary mint purchase button. The secure checkout request runs in parallel with a 2.2-second concealed card spin, glowing sweep, lightning and sparks. No artwork or tier is revealed in this stage. Once checkout is ready and the opening finishes, the browser redirects to Stripe. Reduced-motion preferences or Hide effects bypass the visual wait. A checkout error closes the effects, shows the error and permits retry.

An unpaid click does **not** consume a tier or mint a result. Stripe's verified paid webhook invokes `fulfill_stripe_checkout_verified` and then the existing `allocate_paid_foil` database function from `202610190001_foil_mint_engine.sql`. That function:

- Locks the reserved mint and the artwork's `foil_listings` row inside the fulfillment transaction.
- Uses PostgreSQL pgcrypto `gen_random_bytes` with rejection sampling to obtain an unbiased integer from 1 through 100.
- Assigns the initial tier using the table below, enforces that artwork's global tier caps, and downgrades Prismatic → Sapphire → Emerald → Gold → Silver → Standard for six-tier drops; existing legacy drops retain their old chain.
- Allocates the edition number once and queues rendering. Duplicate payment events or render retries do not reroll.

| Tier      | New six-tier probability | Legacy probability |
| --------- | -----------------------: | -----------------: |
| Standard  |                      60% |                70% |
| Silver    |                      20% |                20% |
| Gold      |                      10% |                 9% |
| Emerald   |                       6% |                 0% |
| Sapphire  |                       3% |                 0% |
| Prismatic |                       1% |                 1% |

Caps are the configured per-artwork global limits, not per-buyer limits. A Prismatic cap of five permits at most five paid Prismatic allocations for that artwork. Caps are locked after the first checkout reservation. The initial percentages change as caps fill; the existing offer disclosure remains visible before purchase. No browser-provided roll, tier, price or rarity result is accepted by the mint-checkout handler.

The private worker renders and signs the allocated variant. The confirmation page polls the verified order status, then loads the permitted private variant. Its separate 1.8-second charge-up and spring-flip reveal keeps the artwork hidden behind a studio seal until completion. Replays are presentation only and never trigger another roll. Neither the master file nor a guessed rarity is delivered while payment or processing is pending.

Secondary-marketplace Buy buttons get the same checkout-opening effects but preserve the existing edition's tier. Resales transfer custody after verified payment; they do not mint another variant or consume rarity supply. Ordinary digital checkout and direct eBay links retain their existing behavior.

## Testing branch

The six-tier upgrade requires `202610190003_six_foil_tiers.sql`; see `docs/SIX-TIER-UPGRADE.md`. The opening animation by itself does not alter backend rules. The existing foil migration, verified Stripe webhook, foil launch gate and private rendering worker must already be configured in your staging environment for real end-to-end minting. The standalone local demo uses simulated responses, not actual payments or a live rarity roll.

`npm.cmd run demo` previews the opening, checkout placeholder and final reveal. Browser tests cover immediate opening while the request is held, hidden artwork, server-authoritative request fields and checkout-error recovery. The SQL fixture additionally forces eight Prismatic roll outcomes against a five-Prismatic cap and verifies five Prismatics, three fallback Standards and no tiers allocated before payment. This does not replace a concurrent staging load test against hosted PostgreSQL.
