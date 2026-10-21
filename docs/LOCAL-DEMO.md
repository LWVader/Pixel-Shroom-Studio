# Local buying and foil-reveal demo

This is a persistent visual preview for your testing branch. It uses the actual collection, marketplace and purchase-confirmation pages with local sample responses. It does not contact Supabase, Stripe, eBay or Modal, collect card details, or create real orders.

## Windows PowerShell

From your project folder, with Node 24 installed:

```powershell
npm.cmd ci
npm.cmd run demo
```

Wait for `Open http://127.0.0.1:8030`, then open that address in your browser. Preparing six rendered variants can take a few seconds. Keep the terminal open; press Ctrl+C to stop. After installing dependencies once, you can also double-click `START-LOCAL-DEMO.cmd`.

## Controls

- **Simulate mint purchase:** opens the actual mint offer page. Click **Pay with Stripe and mint**, watch the concealed checkout-opening effect, then click **Simulate successful payment** on the clearly labeled local checkout placeholder. It does not load Stripe Checkout.
- **Replay reveal:** reloads the actual confirmation page and its 1.8-second charge-up and spring-flip reveal with lightning and a 40-spark burst. Use this button to replay it. After revealing, move the mouse over the card for 3D tilt and holographic glare. Clicking the card or pressing Enter/Space while it is focused also replays the reveal. Replays always finish with the artwork visible rather than toggling back to a hidden card.
- **Tier:** choose Standard, Silver, Gold, Emerald, Sapphire or Prismatic. This selector is a visual testing control, not a choice offered to paying customers. Variants use the actual Sharp mint renderer, with temporary demo signing identities.
- **My collection / sell:** view the edition and click **List on Market** to inspect the pricing dialog and 10% fee quote.
- **Marketplace / buy:** inspect the protected public variant preview, filters and simulated resale checkout/confirmation.

The included Joyful Banana in Candyland WebP is the default demo image. If it is missing, a built-in illustration keeps the demo working. Operating-system reduced-motion preferences disable the spin and lightning. Replay and Skip controls are also available on the confirmation page. There is no pack-opening animation in the current production design. Simulated resale confirmation shows the actual ledger-confirmation text; it does not mint or modify a real edition.

## Why the earlier debug browser looked blank

Playwright `--debug` opens an Inspector and pauses execution, including before the first page navigation. Click Resume or Step over to advance. Tests are automated checks rather than a persistent interactive demo. This new demo stays open for manual browsing and requires no Playwright browser installation.

## Isolation and checks

The server binds only to `127.0.0.1`, blocks external browser connections with a local Content Security Policy, reads only public assets, and keeps fixture data and generated images in memory. The local responses adapt URL checks for loopback use; the production JavaScript files and production payment/image URL validation remain unchanged. Do not deploy this development server as the storefront or expose it through a public tunnel.

`npm.cmd run demo:test` checks all six reveals, image loading, purchase navigation, the seller quote and resale confirmation with no external requests. That automated check requires `npx.cmd playwright install chromium`; manually running `npm.cmd run demo` does not.

If port 8030 is occupied, stop the earlier demo or run:

```powershell
$env:DEMO_PORT = "8031"
npm.cmd run demo
```

Then use the URL printed by the server. Install these update files on top of the secondary-marketplace testing branch; the demo uses its collection and marketplace modules.
