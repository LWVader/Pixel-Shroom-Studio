# Pixel Shroom Studio authenticity update

## Lighthouse performance update

The storefront files in `public/` now include the performance fixes from the
September 27 Lighthouse review:

- `assets/hero-1280.webp` replaces the 2.6 MB hero PNG with a 124 KB WebP.
- `assets/pixel-shroom-logo-128.webp` replaces the 249 KB logo at its actual
  display size.
- The LCP hero is preloaded and marked with `fetchpriority="high"`.
- Image width and height attributes reserve space before decoding.
- Genre navigation is rendered in the initial HTML instead of appearing after
  the database response, eliminating the main page-wide layout shift.
- Catalog and article placeholders reserve stable space while Supabase loads.
- `app.js` and `contact.js` call the existing public Supabase REST and Edge
  Function endpoints directly, so the storefront no longer loads the full
  `supabase-js` dependency graph. The admin continues using `supabase-js`.
- Text contrast and long-lived caching rules for versioned assets are improved.

Copy the contents of this package's `public/` directory over the matching files
in the project's `public/` directory, commit the changes, and redeploy the
Cloudflare site. Do not delete the existing `config.js`, `supabase-client.js`,
genre pages, or other assets that are not included in this update.

## Safe listing deletion

Run `supabase/migrations/202609270003_soft_delete_artworks.sql` once in the
Supabase SQL Editor before deploying the updated admin files. The new Delete
button performs a soft delete: it archives the listing and records
`deleted_at`, removing it from the storefront and Current images without
deleting the artwork row, orders, customers, signature, private original, or
public preview from Supabase. Archived listings remain reversible; deleted
listings remain available as historical records in Supabase.

## Genre-page and category update

Run `supabase/migrations/202609270004_artwork_categories.sql` once in the
Supabase SQL Editor. Paste the SQL contents into the editor; do not paste the
filename itself. The migration validates the complete category list and adds
`Dark Fantasy` and `Horror`.

Deploy the updated `public/index.html`, `public/genre.html`, `public/genre.js`,
`public/parity.css`, `public/admin.html`, and `public/admin.js`. Genre pages now
use the same compact 250-pixel preview viewport and three/two/one-column
responsive card grid as the main catalog. Both query-string URLs such as
`/genre.html?genre=dark-fantasy` and existing clean genre routes are supported.

This update adds four independent authenticity checks to each serialized original:

1. The existing `LWV-...` serial number.
2. A SHA-256 fingerprint of the exact original file.
3. A Pixel Shroom Studio P-256 cryptographic signature over the serial, creator, and SHA-256 fingerprint.
4. An embedded C2PA Content Credential containing the LWV serial and AI-generated source declaration.

The public verification page reads the buyer's selected file locally. It does **not** upload the artwork.

## Files in this package

- `public/admin.html` — adds local signing-key controls to the artwork form.
- `public/admin.js` — hashes and signs originals before private upload.
- `public/index.html` — links to the public authenticity checker.
- `public/verify.html`, `verify.css`, and `verify.js` — public verification page.
- `public/admin-dashboard.css` — responsive five-section administrator layout.
- `public/contact.css` and `contact.js` — storefront message form.
- `supabase/migrations/202609270001_artwork_signatures.sql` — verification records and RLS.
- `supabase/migrations/202609270002_admin_customers_messages.sql` — protected administrator inbox.
- `supabase/functions/add-admin-user` — authenticated administrator invitations.
- `supabase/functions/submit-message` — message storage and email alerts.
- `tools/create-signing-identity.ps1` — one-time local P-256 key and certificate generation.
- `tools/local-signing-server.mjs` — localhost-only helper used automatically by the admin upload.
- `tools/start-signing-helper.ps1` — validates prerequisites and starts the helper.
- `tools/sign-artwork-c2pa.ps1` — optional manual signing fallback.

## 1. Apply the database migration

Run the migration in the Supabase SQL Editor, or copy it into the project's `supabase/migrations` directory and run:

```powershell
npx.cmd supabase db push
```

Apply both migrations in filename order.

The table intentionally stores only public verification material. It never stores the private key or original artwork.

## 2. Create the studio signing identity once

Install OpenSSL, then run from the project root:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\create-signing-identity.ps1
```

If an earlier version of this project already created a self-signed certificate,
replace it safely with:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\create-signing-identity.ps1 `
  -ReplaceInvalidIdentity
```

The switch moves the old identity into a timestamped backup directory before
creating the replacement. It does not delete the old files.

Back up `signing-private.pem` and `signing-root-private.pem` offline. Never
commit them, upload them to Supabase, or place them in the public site. Add the
supplied `.gitignore.additions` entries to the project's `.gitignore`.

The generator creates a private Pixel Shroom Studio root and a separate,
root-signed end-entity certificate with the C2PA-compatible
`emailProtection` EKU. The root certificate is not included in the manifest.
This establishes a self-managed studio identity but does not create third-party
identity trust. A recognized C2PA trust-list certificate is still required for
externally vouched identity. The public verifier reports this distinction as a
"self-managed studio issuer" rather than treating it as content tampering.

## 3. Start the automatic local signing helper

Install the official `c2patool`, then start the helper from the project root:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\start-signing-helper.ps1
```

Keep that PowerShell window open. It displays a random admin-session token. Paste that token into the admin form, then select:

- the finished source artwork as the serialized original;
- `signing-private.pem` as the private PKCS#8 key;
- `signing-public.pem` as the public SPKI key.

When you publish, the admin page sends the source only to `http://127.0.0.1:4179`. The local helper invokes `c2patool`, embeds the title, AI source declaration, creator, and LWV serial, and returns the signed original to the browser. The browser then computes the signed file's SHA-256, signs its canonical identity record, generates the watermarked public preview, and uploads only the signed original to the private bucket.

The helper:

- binds only to the local loopback address;
- accepts only configured storefront origins;
- requires the random token shown in the PowerShell window;
- invokes `c2patool` without a command shell;
- deletes its temporary files after every operation;
- never sends the private key to Cloudflare or Supabase.

Chrome or Edge may ask whether the live site can access a device on the local network. Allow that request while using the administrator page. Close the helper with `Ctrl+C` after publishing.

If the live storefront domain changes, start the helper with the new allowed origin:

```powershell
$env:PIXEL_SIGNING_ALLOWED_ORIGINS = "https://www.pixelshroomstudio.com,https://pixelshroomstudio.com"
powershell -ExecutionPolicy Bypass -File .\tools\start-signing-helper.ps1
```

### Manual fallback

The original manual command remains available if the browser cannot connect to localhost:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\sign-artwork-c2pa.ps1 `
  -InputFile ".\artwork-source.png" `
  -OutputFile ".\artwork-LWV-6331074398.png" `
  -Title "Iron Briars" `
  -SerialNumber "LWV-6331074398"
```

## 4. Deploy

Copy the package's `public` files into the project's `public` directory and deploy through the existing GitHub/Cloudflare workflow. The site has no build step.

Run the existing syntax check first:

```powershell
npm.cmd run check
```

Deploy the two additional Edge Functions:

```powershell
npx.cmd supabase functions deploy add-admin-user
npx.cmd supabase functions deploy submit-message --no-verify-jwt
```

Configure message-alert secrets. `RESEND_FROM_EMAIL` must use a sender/domain verified in your Resend account:

```powershell
npx.cmd supabase secrets set `
  RESEND_API_KEY="re_your_key" `
  RESEND_FROM_EMAIL="LWVader <lwvader@pixelshroomstudio.com>" `
  ADMIN_ALERT_EMAIL="lwvader@pixelshroomstudio.com"
```

The redesigned administrator has exactly five sidebar sections: Dashboard, Customers, Images, Analytics, and Messages. Customer email/image history is calculated from webhook-verified paid orders. The only dashboard Quick Action is Add Admin User. The existing editorial manager remains available inside Images so its functionality is retained without creating a sixth section.

If the Cloudflare Worker sets a Content Security Policy, allow the verifier's pinned SDK origin (`https://esm.sh`) plus WebAssembly. For stricter production control, download and self-host the pinned C2PA browser SDK instead.

## 5. Verify a purchased original

Open `/verify.html`, enter the LWV serial, and select the downloaded original. A complete valid result requires all of these to match:

- local SHA-256 equals the registered fingerprint;
- P-256 studio signature is valid;
- a C2PA manifest is embedded;
- the embedded C2PA data contains the same LWV serial.

Changing even one byte in the original causes the SHA-256 and signature checks to fail.

## Security boundary

- `signing-private.pem` remains under the studio's control.
- The Supabase `originals` bucket remains private.
- Watermarked previews remain the only public artwork files.
- The browser verifier hashes the buyer's file locally.
- Supabase exposes only the public key, signature, serial, creator, and fingerprint.
