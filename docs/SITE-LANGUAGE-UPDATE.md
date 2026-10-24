# Customer language: numbered editions

Replace only the files included in this update, preserving their folder paths. This is a source-file update for the testing branch. It does not deploy the site, change prices, enable a paused collection, alter the database or change payment routing.

## What changed

- Homepage offer, purchase information and short FAQ now explain numbered tier editions and one continuous opening after verified payment.
- The full buyer FAQ covers six uploaded tier images, published odds and caps, server allocation, image formats and dimensions, prepared-copy hashes, automatic image/receipt download requests, accounts, recovery, verification, resale and separate Gelato print orders.
- How it works follows choose, pay, reveal, collect and verify, with a separate explanation for direct-file listings and physical products.
- About, Usage Rights, Terms, Privacy and Cookies distinguish the issued edition file and receipt from the private master. Existing personal/commercial use, editing, redistribution and resale permissions, refund terms and copyright statements remain in place.
- Edition verification is the main verification destination; the original-file verifier remains available for earlier direct-file purchases.
- Main navigation and footer links expose My collection and Marketplace. Existing nine genre destinations, latest-14 homepage gallery, hero, font, palette and category navigation font size remain in place. Navigation wraps to avoid overflow.
- Visible FAQ answers and FAQ structured data match. Relevant descriptions, social metadata and llms.txt reflect the same model.

## Verification

Run `npm.cmd run check`, `npm.cmd test` and `npm.cmd run test:e2e`. Browser tests use fixture payments and private-delivery mocks; they do not charge customers or deploy services. `npm.cmd run demo` still starts the local buying demo.

New content checks compare visible FAQ answers to structured data, preserve the nine genre links, and verify that edition and original-file verification remain connected. Existing browser checks cover routes, desktop/mobile layouts, accessibility, purchases, reveal, marketplace, Gelato physical checkout and admin uploads.
