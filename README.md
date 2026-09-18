# Pixel Shroom Studio — HTML, CSS and JavaScript edition

This conversion uses ordinary HTML, CSS and browser JavaScript with a dependency-free Node.js JavaScript server. SQLite is provided by Node 22's built-in `node:sqlite` module.

## Run

1. Install Node.js 22.13 or newer.
2. Copy `.env.example` to `.env` and replace every secret.
3. Run `npm start`.
4. Open `http://localhost:3000`.
5. Admin: `http://localhost:3000/admin.html`.

Genre pages use clean addresses such as `http://localhost:3000/genre/fantasy`, `/genre/sci-fi`, and `/genre/nft`.

Each genre fallback is stored as its own 512×512 image in `public/assets/`; the website no longer depends on a grouped sprite sheet.

The starter admin is `phantasmocazdor@gmail.com` with password `password`. Change the password immediately from the admin screen.

If an existing database rejects the administrator password, stop the server and run `node reset-admin-password.js`. This resets only the administrator credential and preserves the catalog, articles, orders, and licenses.

## Security model

- `private-originals/` is never exposed as a static directory. `.gitkeep` contains no image data; it only preserves the empty folder in source control.
- For a local original, enter only its filename or relative path from `private-originals/` in the admin field.
- For the storefront, paste Postimages’ **Hotlink for websites** code for a separate resized image with a permanent full-photo watermark. The server extracts its HTTPS image URL for display.
- For the purchased original, paste the original `.png` **Direct link** into the password-masked private field. It is stored only in SQLite, omitted from every browser API response, and fetched server-side only after verified payment. Approved hosts are controlled by `PRIVATE_IMAGE_HOSTS`.
- The public hotlink and private original link cannot be identical. A CSS watermark is also shown as a minor deterrent, but CSS alone is not security.
- Orders become paid only through a verified server webhook. Placeholder Stripe and PayPal verification functions deliberately reject requests until configured.
- Originals are released through signed, expiring tokens with download limits.
- NFTs never use automatic download links. After verified payment, their ZIP packages remain marked `email_pending` until the administrator manually emails the package and marks it sent.
- Never store an original Postimages direct URL in `previewUrl`. Store only an opaque key or local private filename in `originalKey`.

The admin dashboard manages artwork and NFTs, embedded serial-number records, prices, preview images, display dimensions, publishing status, articles, password changes, and order statistics. Site colors and layout are maintained directly in `public/styles.css` and `public/parity.css`.

Each listing stores the same custom serial number that has already been embedded into the completed artwork, such as `LWV-3249949452`. The browser records and displays this identifier; it does not add the serial visually with removable CSS or JavaScript.

## Payment setup

Search `PAYMENT_PROVIDER_CONFIGURATION_REQUIRED` in `server.js`. Replace those two placeholder verifiers with the official Stripe and PayPal SDK verification calls, then provide the environment secrets. The browser success screen never marks an order paid.
