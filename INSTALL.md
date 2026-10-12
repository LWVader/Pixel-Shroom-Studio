# Add AD Studio to Pixel Shroom Studio admin

This is an update package for https://www.pixelshroomstudio.com/, not a replacement storefront. It adds an AD Studio sidebar section, embeds the full editor on your own domain, and uses the existing Supabase administrator login. The existing worker, storefront, checkout, Supabase configuration and admin JavaScript stay in place.

The included admin.html was patched from the live page fetched on October 12, 2026. Its original HTML and admin.js matched the supplied local audited build exactly. If you have changed admin.html since then, merge only the AD Studio navigation button and section instead of replacing newer changes.

## Install

1. Back up your current deployment. Merge this package into your existing project root. Keep your existing worker.mjs, package.json, public/config.js and public/supabase-client.js. Do not deploy this ZIP as a complete standalone project.
2. In your existing wrangler.jsonc or wrangler.toml, change only the `main` entry to `worker-ad-studio.mjs`. Keep your existing Worker name, routes, asset binding and other settings.
3. Create a D1 database with `npx.cmd wrangler d1 create pixel-shroom-ad-studio` (Windows), or `npx wrangler d1 create pixel-shroom-ad-studio` on other platforms. Add its returned database_id to a d1_databases entry with binding `AD_STUDIO_DB` in the existing Wrangler configuration. Preserve any other database bindings. The binding name must be exactly AD_STUDIO_DB.
4. Apply the two new tables: `npx.cmd wrangler d1 execute pixel-shroom-ad-studio --remote --file=migrations/ad-studio.sql`. Use this SQL only on the newly created AD Studio database. It does not change Supabase or storefront tables.
5. Generate a random 32-byte encryption key: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Store the resulting 64 hex characters as the Cloudflare Worker secret using `npx.cmd wrangler secret put BUFFER_CREDENTIAL_ENCRYPTION_KEY`. Keep this key stable: changing it makes saved publishing credentials unreadable. Do not put it in browser files, Git, or Wrangler vars.
6. Deploy using your existing Cloudflare workflow, with worker-ad-studio.mjs as the entry point. No new npm dependency is required by this integration.
7. Sign in at /admin.html and select AD Studio. For the larger editing workspace, use Open full screen. The editor is served from /admin-ad-studio/index.html on your own domain, with no ChatGPT login requirement.
8. In Publish to social, enter your personal Buffer API key again. Credentials from the separate ChatGPT-hosted studio are not copied. The key is validated with Buffer, encrypted server-side, and associated with your Supabase user ID.
9. For video publishing, connect optional Cloudinary hosting or enter a stable public MP4/MOV URL. Buffer cannot fetch private project files or browser-only video blobs. Scheduling converts the browser's local date/time to UTC before sending it to Buffer.

## What is included

- Patched public/admin.html: new AD Studio navigation and embedded workspace.
- public/admin-ad-studio/: editor, all characters, 13 frame/display styles, two photo cubes, ten animations, half-speed playback/export, logo, backgrounds, video export, Buffer publishing and scheduling.
- worker-ad-studio.mjs: delegates existing routes to your current worker.mjs; adds authenticated /api/ad-studio/social/* routes and same-origin framing headers for the editor.
- lib/ad-studio-social.mjs: Buffer integration, encrypted credentials, persistent submission/status records and duplicate-submission protection.
- migrations/ad-studio.sql: the new D1 tables only.

## Access and verification

The editor checks your existing Supabase admin_users membership before displaying. Publishing verifies the Supabase access token with /auth/v1/user and checks admin_users server-side on every request. Browser-supplied identity headers are not trusted. Same-origin POSTs are required. Static editor assets contain no private project artwork or credentials.

After deployment, check an admin sign-in, an ordinary/non-admin account, logout, photo replacement, video export, Buffer connection, and a deliberately selected test destination if you want a live publishing test. No live social post was sent during package preparation. The existing Cloudflare account deployment and browser recording were not exercised here.

## Rollback

Restore your previous public/admin.html and original Wrangler main entry (worker.mjs). The new D1 database can remain unused; do not delete it if you may need saved credentials or submission history later.

## Longer post composer

The resizable post text box accepts 25,000 draft characters and displays a live count plus selected-channel guidance. Facebook/YouTube allow 5,000 and LinkedIn 3,000 through Buffer; other channels have their own limits. Buffer validates the final text and account-specific rules. Text is never automatically shortened.

## On-ad text and fonts

Editor → right sidebar → Bottom · Caption, button & website now includes a 600-character multiline on-ad caption, a visible copy preview, and a searchable snapshot of all 1,950 Google Fonts families plus eight system fonts, including Comic Sans MS. Selected fonts download on demand from Google; internet access is required for web fonts. System fonts work without web-font downloads. The selected family applies to the caption, CTA and website in the canvas and exports. Caption size, weight and alignment are saved with the project. Long captions shrink to fit the available bottom space. Export waits for the selected font. These controls format the image/video itself; social post captions remain plain text.

## Collapsible tools and publishing preview

The font picker collapses after selection and displays the selected family in its summary. A collapsible searchable emoji section inserts into the selected ad or social text field at its current cursor. The Editor bottom section now owns social post copy and platform settings; step 4 on Publish is a read-only preview with an Edit post text button. Social title/caption and platform settings are saved in project JSON.
