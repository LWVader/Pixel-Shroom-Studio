# Finished tier uploads — current delivery workflow

This replaces generated foil overlays for new purchases. Apply this update to the testing branch over the current six-tier, marketplace and paid-reveal build. The prehashed-inventory model in this guide supersedes the original byte-identical copy model. No images have been uploaded to your hosted account and nothing has been deployed by this update.

## Your Admin workflow

1. Add or edit the artwork using the existing master, signature and protected-gallery-preview workflow.
2. Under **Artwork tier images and numbered editions → Finished images for each tier**, select a complete image for Standard, Silver, Gold, Emerald, Sapphire and Prismatic. These are finished designs, not transparent overlay templates. Each artwork has its own set.
3. Use PNG, JPEG or WebP below 100 MB (allow room for copy metadata) and 100 million pixels each. Pixel dimensions are recorded for customers. Animation/multi-frame formats are unsupported.
4. Set the same supply and rarity caps as before. Use **Save private draft** for an incomplete upload, or upload all six images before publishing. Enabling checkout also requires finished copy-hash preparation.
5. The private tier mappings lock after the first uploaded-image reservation, including a later expired reservation. A new release/listing is needed to change its purchased designs. Caps, master and pricing retain their existing lock rules.

The tier images are uploaded to private `originals` paths with random filenames and no overwrites. The public catalog exposes dimensions and format, never these paths. Files uploaded during an unsuccessful form save can remain unreferenced; retry the save, and remove orphaned objects only after checking that no tier mapping references them. Do not overwrite/delete registered sources: delivery checks their recorded hash and will stop if they are changed.

## Purchase and delivery

Choose artwork → pay → server verifies payment → secure tier roll with existing caps → concealed opening while the selected image is prepared → reveal → **Add to my collection**.

When tier images are saved, the authorized number of copy identities is created for each image. The private worker adds copy-identification metadata without changing or recompressing the encoded pixels, computes the actual SHA-256 of each resulting file, and stores those distinct hashes before checkout opens. Rare images receive as many prepared hashes as their tier caps. Standard prepares up to maximum supply to support downgrades; this is fallback capacity, not permission to exceed the drop's total supply.

After verified payment, the secure tier roll atomically assigns one unused prepared copy and hash from that tier. Retries keep that assignment. The delivery worker reproduces that exact metadata-bearing file, checks it against its precomputed hash, stores it privately, and signs the individual mint receipt. Sources and unassigned inventory are never downloadable by customers. Each copy has a unique file hash, mint number and signed receipt. Visible artwork, image format, pixel dimensions and compressed pixel data stay unchanged; file bytes differ because of the copy metadata. Previously embedded source signatures are not a substitute for the new receipt covering those changed bytes.

Incomplete foil uploads may only be saved as private drafts. Publishing requires all six registered tier images, enforced by both Admin and a database trigger. Checkout additionally waits until all authorized hashes are ready. Existing digital purchase delivery and NFT paths remain supported. Newly published non-NFT artwork requires all six tier images.

The shared private worker is still needed for protected fulfillment, receipts and watermarked resale previews. Public resale previews can be resized/watermarked; the purchased private images remain unchanged. Resales retain the existing tier, mint number, file and receipt.

## Testing-branch installation

1. Apply earlier migrations through `202610190004_post_reveal_collection.sql` first. Then apply `202610190005_uploaded_tier_assets.sql` and then `202610190006_prehashed_copy_inventory.sql` once to the **testing** Supabase project. Verify the linked project before running `npx.cmd supabase db push`, which applies every pending migration.
2. The uploaded-tier migration pauses existing foil listings so new checkouts cannot silently use generated effects. Existing files/owners/tiers/receipts are retained. Pre-migration reservations and paid queued jobs keep the legacy processor to honor their original delivery behavior. Existing migration-5 reservations retain their previously promised bytes. New reservations use the prehashed copy inventory.
3. Redeploy the updated worker to your staging Modal environment:

```powershell
.\.venv-modal\Scripts\modal.exe deploy modal_mint.py
```

No new signing key, secret or Edge Function is needed for this patch. The existing authenticated Admin calls new protected SQL RPCs. Keep the existing primary and secondary launch gates and Stripe webhook configuration.

4. Deploy the updated storefront through the testing branch's existing deployment process. Open Admin, upload all six designs for each artwork, save, and explicitly re-enable that listing's foil option. Incomplete uploads remain drafts. The worker prepares hashes in batches; reopen the listing to see the prepared/authorized count. Checkout stays paused until it is complete.
5. Test a Stripe test-mode purchase, the hidden-image animation, matching tier bytes and receipt, explicit profile saving, private download, and resale. In staging, exercise each tier using controlled test fixtures rather than weakening production RNG or accepting client-supplied tiers.

## Local demo

Restart `npm.cmd run demo`. The six supplied finished designs in `tools/demo-assets/tiers/` are the defaults: unframed Standard, Silver, Gold, Emerald, Sapphire and Prismatic. Each reveal uses its matching uploaded image; no foil effects are generated.

To preview your actual finished variations, create a local folder containing `standard`, `silver`, `gold`, `emerald`, `sapphire`, `prismatic` with `.webp`, `.png`, `.jpg` or `.jpeg` extensions:

```powershell
$env:DEMO_TIER_DIR = "C:\Private\PixelShroomDemoTiers"
npm.cmd run demo
```

When `DEMO_TIER_DIR` is set, all six files must exist. These are local demo files and are not uploaded anywhere. The tier selector controls demo fixtures only, not real purchase outcomes.

## Checks

Legacy unit/integration checks exercise exact copies in all three formats for all six tiers, different receipts for identical source bytes, source-tampering rejection, full worker upload MIME/path handling, database readiness gates, immutable asset mappings, private access and lease fencing. Browser tests cover Admin's six upload slots and locked state alongside the existing purchase/reveal/marketplace flows. Real account deployment and Stripe test-mode acceptance remain your staging step.

## Prehashed inventory notes

Migration 6 creates `foil_copy_inventory` and a queued preparation task for each authorized copy. The worker prepares up to 25 hashes per claimed batch. It saves identities/hashes rather than storing hundreds of full-size duplicates before anyone buys; delivery deterministically reconstructs the already-hashed file. Never alter the copy-identification algorithm for an existing inventory. Uploaded source paths/hashes lock after the first reservation.

For transient preparation failures, retries preserve identity. After five failures the copy is held; examine worker logs and correct the source issue. Before any inventory purchase has been reserved, re-uploading the tier image also requeues failed preparation rows. Do not reset an assigned copy or manufacture replacement hashes for an existing sold edition.

The local demo remains a simulated single-copy UI fixture. Real inventory authorization, upfront preparation and payment assignment are verified by automated database/worker tests and must also be accepted in your staging deployment. No production rollout was performed.
