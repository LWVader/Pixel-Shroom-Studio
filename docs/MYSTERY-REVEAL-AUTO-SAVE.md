# Mystery reveal and one-action delivery

Replace only the files contained in this update, preserving their folders. Restart the local demo with `npm.cmd run demo`. Production deployments must include the updated checkout HTML, JavaScript and CSS together; their cache versions are synchronized.

After verified payment, the opening runs on a separate full-screen surface. It shows no interface text, tier-colored lighting or tier artwork. The opening uses the supplied portrait card backing, including its original printed lettering, against the supplied forest backdrop. Both faces remain covered until the animation completes. The demo also hides its surrounding controls during opening. Escape skips the ready-edition animation; reduced-motion preferences are respected. Queued editions keep spinning, with their artwork concealed until ready.

After reveal, Add to my collection saves the edition to the authenticated account and requests two downloads: the exact minted image and its signed JSON receipt. The confirmation page remains open. Collection saving is idempotent; a download failure leaves the saved edition intact and offers a retry for the same edition. Already-saved editions offer file downloads without another collection write. Browsers control local file saving and may ask users to allow multiple downloads.

The server remains authoritative for payment, ownership, inventory, tier selection and file identity. Replays and delivery retries never reroll or allocate another copy. Existing ordinary digital checkout and collection/marketplace payment paths are unchanged.

Validation: `npm.cmd run demo:test` and `npx.cmd playwright test tests/e2e/foil.spec.js`.

The opening starts as soon as verified payment is received and the preloaded card backing can render. One continuous fast rotation covers server preparation and private image decoding. When the actual edition is decoded, the same rotor slows from its current angle and speed to a whole turn, then reveals the artwork. There is no stationary waiting-card stage, replacement scene, or second animation. Slow preparation extends the moving concealed phase. Reduced-motion preferences still disable spinning.

The same forest dialog stays mounted and open from payment confirmation through reveal. Its arrival fade is brief and does not restart at readiness. Card backing and forest assets preload on the confirmation page. Existing download, signed-receipt, collection and payment authorization behavior remains intact.
