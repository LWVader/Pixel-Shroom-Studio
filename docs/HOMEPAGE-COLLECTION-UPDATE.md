# Homepage and All artwork update

The homepage now shows up to14newest published artworks across every genre, using artwork creation time. Unpublished listings remain private. All artwork is a separate indexable page at `/all-artwork.html`, with up to4random previews per genre, a refresh control and a link to each full genre collection. The old "All artwork · genre sampler" label was removed. The existing font rules, palette and hero are preserved.

Replace `worker.mjs`, `public/app.js`, `public/catalog-core.js`, `public/index.html`, `public/sitemap.xml`, and all other HTML files under `public/` (including `public/genres/`) because their All artwork links were updated. Add `public/all-artwork.html`. Asset images, font styles, Supabase functions and migrations do not need changes for this update. Keep your existing deployment configuration, domain bindings and public project settings.

Deploy through your existing Cloudflare workflow. This package does not deploy itself. After deployment confirm `/` shows recent artworks, `/all-artwork.html` shows genre samples, and legacy artwork routes redirect to the collection page.
