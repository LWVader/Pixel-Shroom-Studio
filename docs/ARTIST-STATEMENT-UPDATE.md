# Artist statement and provenance update

Copy the included files to the matching project paths, then deploy through your existing workflow (`npm.cmd ci`, `npx.cmd wrangler deploy`). The build preserves readable source and generates minified deployment assets.

The homepage trust section follows the three shopping paths. `/about.html` contains the full statement and a creator introduction. Artwork cards carry a concise provenance explanation. The FAQ includes a matching structured-data answer explaining serial numbers, SHA-256 master-file fingerprints and studio signatures. The new About page is included in the sitemap and llms.txt; `/about` redirects to `/about.html`.

Existing payment, delivery and Gelato checkout paths, permissions, nine genres, hero image, palette, fonts, 16px navigation and latest-14 gallery are preserved. No new database migration, service or secret is needed for this update. Signing documents the registered studio-issued master and its integrity; it does not establish exclusivity or independently prove copyright ownership.
