# Pixel Shroom Studio authenticity update

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

Back up `signing-private.pem` offline. Never commit it, upload it to Supabase, or place it in the public site. Add the supplied `.gitignore.additions` entries to the project's `.gitignore`.

The generated self-signed certificate establishes a studio-controlled cryptographic identity. It does not create third-party identity trust. A recognized C2PA trust-list certificate would be required later for externally vouched identity.

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
$env:PIXEL_SIGNING_ALLOWED_ORIGINS = "https://your-new-domain.example"
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
  RESEND_FROM_EMAIL="Pixel Shroom Studio <messages@your-verified-domain.com>" `
  ADMIN_ALERT_EMAIL="phantasmocazdor@gmail.com"
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
