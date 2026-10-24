# Canvas rolls, digital bundles and Forge workflow

Updated October 22, 2026. Currency: USD. Physical delivery: United States only.

This is the updated business/workflow specification for implementation. Adding this document does not activate new prices, bundle guarantees, a Forge, free claims or a new payment path. The existing Gelato integration and preflight code retain their current behavior until the corresponding backend and account UI are implemented and tested.

## 1. Offers and tier mappings

All six tiers use the studio-uploaded finished image variation, never a newly generated border or overlay. A digital deliverable has its own assigned copy identifier, exact-file hash and signed receipt. A public preview is not the downloadable source or print production file.

| Tier      | Base single-roll odds | Physical canvas                      | Estimated production | Exported US delivery | $69 less production | Product contribution rate before other costs |
| --------- | --------------------: | ------------------------------------ | -------------------: | -------------------: | ------------------: | -------------------------------------------: |
| Standard  |                   60% | 16 × 16 slim, unframed               |               $27.09 |               $13.49 |              $41.91 |                                        60.7% |
| Silver    |                   20% | 16 × 16 slim, unframed               |               $27.09 |               $13.49 |              $41.91 |                                        60.7% |
| Gold      |                   10% | 16 × 16 thick, unframed              |               $35.19 |               $13.49 |              $33.81 |                                        49.0% |
| Emerald   |                    6% | 16 × 24 portrait, Black wood frame   |               $60.42 |               $10.49 |               $8.58 |                                        12.4% |
| Sapphire  |                    3% | 16 × 24 portrait, Dark wood frame    |               $60.42 |               $10.49 |               $8.58 |                                        12.4% |
| Prismatic |                    1% | 16 × 24 portrait, Natural wood frame |               $60.42 |               $10.49 |               $8.58 |                                        12.4% |

Sources: `Canvas_US_2026-10-22.csv` and `Framed Canvas_US_2026-10-22.csv`, supplied Gelato US exports. The framed export labels Natural wood as “Wood”; verify the exact product UID/finish before publication. These exports contain prices and descriptions, not authoritative API UID mappings. Product availability and current costs require actual destination quotes. No 24 × 24 upgrade or metal product is included in this release plan.

The last column is not net margin. It excludes delivery, processing, supplier taxes, software, support, replacements, refunds and other expenses. Standard/Silver differ in artwork. Silver/Gold differ in canvas thickness. Gold/Emerald adds the portrait framed format. Emerald/Sapphire/Prismatic change image and frame finish, rather than increasing physical size.

## 2. Canvas Mystery Roll: $69 + $13.49 shipping

The customer pays $82.49 before applicable tax: $69 for one physical-plus-digital roll and a $13.49 flat delivery charge. Show both amounts and applicable tax before payment. The flat rate is charged once; it is a customer price, not a promise that every Gelato delivery quote equals $13.49.

Keep the previously selected hold-until-redeemed behavior:

1. Choose the artwork, sign in and provide a supported US delivery address. Review digital delivery, physical tier mappings, odds, included print and deferred production terms.
2. Verify that all possible physical outputs can be supplied to the destination and that prepared digital inventory can satisfy a paid result. Create the checkout using server prices. The chosen SKU cannot come from a client-provided tier.
3. Verify the payment webhook, then atomically assign one tier and prepared copy. Repeated webhook events and job retries retain that same result, copy and hash.
4. Start the concealed reveal only after verified payment. The animation presents the server outcome; it does not choose a tier. Add to collection retains the existing automatic image/receipt download behavior.
5. Save one prepaid canvas entitlement and one paid shipping credit against this asset. No Gelato production order is submitted yet.
6. The buyer selects Redeem canvas when ready. Lock the entitlement against Forge/resale/another redemption, confirm the delivery address and current mapped product/file, and resolve any tax/address change before fulfillment. Do not charge the already-paid $69 product or $13.49 shipping again.
7. Submit one Gelato order using the assigned tier's private, preflight-approved production file. A timeout after a create request requires reconciliation by stable order reference, never a blind second create.
8. Mark the entitlement used and expose order status/tracking in the buyer account. Payment or production failures enter a recoverable support state; they do not create another free claim.

A Canvas Mystery Roll yielding Prismatic still contains one physical claim total. It does not also receive the digital-only Prismatic promotion as a second canvas.

### Canvas roll economics

Using the base odds and exported costs, with every order redeemed and no forging:

- Weighted production: 0.80 × $27.09 + 0.10 × $35.19 + 0.10 × $60.42 = $31.233, displayed as **$31.23**.
- Product revenue less production: **$37.77**, about **54.74%** of $69.
- Weighted Gelato delivery: 0.90 × $13.49 + 0.10 × $10.49 = **$13.19**.
- Collected delivery is $13.49, leaving **$0.30 average delivery contribution** before fees.
- Illustrative domestic-card processing at 2.9% + $0.30 on $82.49: **$2.69 per transaction** after cent rounding.
- Expected contribution after production, delivery and that rounded payment fee: **about $35.38**, before tax-related charges, cloud costs, replacements, refunds and other expenses.

Payment fees on applicable tax and nonstandard cards/payment methods can differ. Actual account rates take precedence. Stripe reference: https://stripe.com/pricing/local-payment-methods . Do not advertise these amounts as net profit or guaranteed margin.

## 3. Digital-only rolls and bundles

Digital-only products include digital images and receipts. They do not include the paid physical entitlement of a $69 canvas roll. Physical delivery is purchased later at the tier price in section 4, except for one eligible Prismatic free-production claim.

| Offer                 | Price before applicable tax | Images delivered | Price per roll | Guarantee                                                                                 |
| --------------------- | --------------------------: | ---------------: | -------------: | ----------------------------------------------------------------------------------------- |
| Single Digital Roll   |                          $8 |                1 |          $8.00 | None beyond one assigned digital image                                                    |
| 3-Roll Forge Pack     |                         $21 |                3 |          $7.00 | Three results, no rarity floor                                                            |
| 5-Roll Guarantee Pack |                         $32 |                5 |          $6.40 | At least one Silver-or-better result or enough same-artwork Standards to forge one Silver |
| 10-Roll Hunt Bundle   |                         $59 |               10 |          $5.90 | At least one Gold-or-better result among the ten delivered images                         |

Each bundle selects one artwork so its Forge-equivalent guarantee can actually be met. A mixed-artwork bundle cannot make this promise under a same-artwork Forge rule.

The five-pack's Forge equivalent is not an extra image or an automatic free Silver on top of five Standards. If all five are Standard, the buyer may explicitly consume the five to obtain one Silver. Explain this before checkout. Do not automatically burn them.

The ten-pack requires a real server-side guarantee. Implementation rule: allocate the ten base results; if none is Gold or better, replace one lowest-tier result with Gold, using reserved Gold stock. Deliver ten images, not eleven. Store the final results and guarantee adjustment atomically with an idempotent purchase/bundle identifier. A retry must never reroll the bundle. This floor changes the final bundle distribution; 60/20/10/6/3/1 describes base rolls, not the guaranteed bundle's final per-image odds. Publish both the base odds and the floor rule. An alternative guarantee algorithm requires explicit revised disclosure.

Reserve enough inventory for the full bundle and its floor before taking payment. Never downgrade a promised Gold because a cap was reached. If inventory cannot honor the advertised distribution or guarantee, close the affected offer until replenished or publish revised rules for future purchases. Existing paid outcomes remain committed.

The $0.02 storage/bandwidth figure is a planning assumption per delivered file, not a verified cost. Large PNG downloads and repeat delivery can cost more.

## 4. Digital-to-canvas redemption

The buyer chooses a specific currently owned, eligible digital asset. Its own tier sets the product and price; owning a higher-tier asset does not upgrade every lower-tier file in the account.

| Selected asset tier                  | Physical product                     | Product charge | Flat shipping | Before-tax checkout | Production | Product charge less production |
| ------------------------------------ | ------------------------------------ | -------------: | ------------: | ------------------: | ---------: | -----------------------------: |
| Standard / Silver                    | 16 × 16 slim, unframed               |            $49 |        $13.49 |              $62.49 |     $27.09 |                 $21.91 (44.7%) |
| Gold                                 | 16 × 16 thick, unframed              |            $55 |        $13.49 |              $68.49 |     $35.19 |                 $19.81 (36.0%) |
| Emerald                              | 16 × 24 portrait, Black frame        |            $79 |        $13.49 |              $92.49 |     $60.42 |                 $18.58 (23.5%) |
| Sapphire                             | 16 × 24 portrait, Dark wood frame    |            $79 |        $13.49 |              $92.49 |     $60.42 |                 $18.58 (23.5%) |
| Prismatic, eligible unused promotion | 16 × 24 portrait, Natural wood frame |             $0 |        $13.49 |              $13.49 |     $60.42 |       Studio-funded production |

Applicable tax is additional and follows the configured product/claim treatment. “Free claim” means the production/product charge is waived; shipping is still $13.49. Display that condition wherever free canvas is advertised. The promotion is one physical canvas per eligible Prismatic asset, not one per login, download, receipt copy or owner change. It requires current ownership, unused eligibility and no refund/dispute/revocation hold.

Distinguish `included_prepaid`, `paid_print` and `prismatic_promotion` claim origins. Claim state must survive resale and cannot reset when an asset changes accounts. Canvas Mystery Roll assets use their included prepaid benefit, not this print-price table. A forged Prismatic created from an existing prepaid canvas entitlement uses the carried prepaid benefit, without creating a second promotional claim.

Atomic claim reservation prevents two tabs/devices from redeeming the same benefit. Once a claim is bound to a payable checkout or fulfillment submission it cannot simultaneously enter a Forge. Expiry/cancellation must be verified with the payment provider before unlocking it. Restoring a claim after an operational failure is an audited, idempotent action. Repeat paid print purchases, if later offered, must be explicitly presented as additional paid copies rather than another free redemption.

A directly pulled Prismatic can come from the first $8 roll. Finance promotional production at the overall offer/cohort level; do not assume every free claimant generated $295 revenue.

## 5. Forge rules

| Inputs consumed   | Output            |
| ----------------- | ----------------- |
| 5 Standard images | 1 Silver image    |
| 3 Silver images   | 1 Gold image      |
| 3 Gold images     | 1 Emerald image   |
| 2 Emerald images  | 1 Sapphire image  |
| 2 Sapphire images | 1 Prismatic image |

Use distinct, currently owned assets of the same artwork and input tier. Check paid eligibility, ready state, claim state, marketplace locks and available authorized output inventory. Reserve the exact upgraded copy/hash before atomically marking inputs consumed and recording their lineage. A deterministic upgrade is not another random roll. Use an operation idempotency key and unique input-consumption records. Reject concurrent reuse, duplicates and ownership changes.

Burning retires the platform records and their future trading/claim benefits. It cannot delete downloaded files or revoke usage permissions already promised to customers. Preserve an immutable audit history and source receipts. The output gets its own copy identifier/hash/receipt and provenance to the inputs.

Prepaid canvas entitlements remain distinct from digital-only assets. As previously selected, combining unused prepaid entitlements produces at most one upgraded prepaid print entitlement, not the sum of their original print claims. The new upfront-shipping rule introduces a remaining billing decision: how unused shipping payments from the consumed canvas rolls are refunded or credited. Also define mixed prepaid/digital-input treatment. Do not activate that class of Forge until those rules and its irreversible confirmation are implemented. Digital-only forging does not carry a $69 prepaid print benefit; the output uses section 4 pricing or its eligible Prismatic promotion.

Starting entirely with Standard images requires **5 × 3 × 3 × 2 × 2 = 180 Standards** to reach one Prismatic. Higher-tier pulls reduce the inputs needed. Fractional outputs are accounting equivalents, not assets: two Gold images cannot be forged into 0.67 of an Emerald. They remain two Golds until a third is supplied.

## 6. Corrected 50-roll example

For five $59 ten-roll bundles:

- Gross digital revenue: **$295**.
- Illustrative domestic-card fee per $59 transaction: round($59 × 2.9% + $0.30) = $2.01; five transactions = **$10.05**.
- Independent base 1% Prismatic rolls have an expected count of **0.5**, not a guaranteed result.
- Chance of zero Prismatics: **60.50%**; exactly one: **30.56%**; two or more: **8.94%**. Chance of at least one: **39.50%**.
- About 30 Standards is a base-roll expectation. The ten-pack floor adjusts the final tier distribution, so it is not the exact expected delivered Standard count under the guarantee. The specified Gold-only floor does not itself create a Prismatic.
- If exactly one eligible free canvas is claimed, $295 − $10.05 − $60.42 = **$224.53 before cloud costs, delivery/payment reconciliation, supplier taxes, refunds, support and overhead**.
- At the assumed $0.02 × 50 files, subtract another **$1**, leaving **$223.53 before the other listed costs**. Promotional shipping is charged separately and its revenue, provider delivery cost and payment fee must also be recorded.

This is a conditional illustration, not expected or pure net profit. A customer may claim zero, one or several qualifying canvases, and higher-tier stock/Forge activity changes the results. Budget future free-claim obligations when eligible assets are issued, rather than treating all current cash as profit.

## 7. Admin, images and implementation boundaries

Maintain six finished digital variants plus the matching product-specific private print files. Square and portrait are different compositions; do not auto-stretch or silently crop a square artwork to 16 × 20. Digital file size and print production size are separate fields. A 4096 × 4096 digital PNG gives 256 PPI at 16 inches; 300 PPI requires 4800 × 4800 for a 16-inch square and 4800 × 6000 for a 16 × 24 portrait, before product-specific wrap and bleed. Metric catalogue dimensions may differ slightly; the actual UID template controls production.

Keep the existing owner Safe check and its manual review. Enter exact dimensions, orientation, substrate/depth/frame finish, product UID and print-source mapping per tier. All six required outputs must be configured and checked before opening the associated offer. Never invent product UIDs from frame names or use the public protected preview as the print source.

Implementation must add distinct canvas/digital SKUs, atomic multi-roll allocation and guarantees, prepaid/promotion claim records, Forge lineage and locks, shipping-credit reconciliation, and the new account flows. Integrate them with the existing signed-copy inventory, verified payment/reveal sequence and Gelato reconciliation safeguards. Existing signed receipts, completed purchases and permissions retain their original terms; apply these offers to explicitly versioned new purchases.

Before activation, test duplicate/delayed payment events, partial bundle failure, depleted floor stock, two simultaneous claims/forges, refund/dispute holds, resale ownership, ambiguous Gelato creates, address/tax changes, one-time promotional claims and shipping-credit treatment. No real charge, order or shipment is authorized merely by this workflow document.
