# Mystery reveal and one-action delivery

Replace only the files contained in this update, preserving their folders. Restart the local demo with `npm.cmd run demo`. Production deployments must include the updated checkout HTML, JavaScript and CSS together; their cache versions are synchronized.

After verified payment and server preparation, the opening runs on a separate full-screen surface. It shows no interface text, tier-colored lighting or tier artwork. The opening uses the supplied portrait card backing, including its original printed lettering, against the supplied forest backdrop. Both faces remain covered until the animation completes. The demo also hides its surrounding controls during opening. Escape skips the ready-edition animation; reduced-motion preferences are respected. Queued editions remain concealed until ready.

After reveal, Add to my collection saves the edition to the authenticated account and requests two downloads: the exact minted image and its signed JSON receipt. The confirmation page remains open. Collection saving is idempotent; a download failure leaves the saved edition intact and offers a retry for the same edition. Already-saved editions offer file downloads without another collection write. Browsers control local file saving and may ask users to allow multiple downloads.

The server remains authoritative for payment, ownership, inventory, tier selection and file identity. Replays and delivery retries never reroll or allocate another copy. Existing ordinary digital checkout and collection/marketplace payment paths are unchanged.

Validation: `npm.cmd run demo:test` and `npx.cmd playwright test tests/e2e/foil.spec.js`.

The opening now starts at full rotational speed and slows continuously across 4.2 seconds, without a charge-up pause. The forest stage has no clipped rectangular boundary or automatic focus outline; a light edge mask softens the backing into the scene while preserving its lettering. Lightning and glow can extend outside the card bounds. The actual artwork remains concealed until the animation finishes.
