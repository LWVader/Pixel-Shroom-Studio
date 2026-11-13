# Artwork upload size

Admin → Images checks PNGs larger than 9 MiB before uploading. The local signing helper tries lossless PNG compression at the existing dimensions. It removes the alpha channel only when every pixel is opaque and uses the original file if optimization does not make it smaller. The browser reads the Standard serial first, optimizes the file, then signs it. Other tier hashes are calculated from the exact bytes uploaded.

To install this update:

1. Copy the files in the update ZIP to the matching paths in your project. No database migration is required.
2. Deploy with `npx.cmd wrangler deploy` or your existing Cloudflare workflow.
3. Stop the old signing helper and start the updated copy with `.\tools\start-signing-helper.ps1`. Use its token in Admin → Images, refresh the page, and retry the upload. The helper uses the existing Sharp dependency and signing identity; run `npm.cmd ci` if dependencies are missing.

The 9 MiB threshold starts optimization; it is not a guarantee that every PNG will end up below 9 MiB. Existing PNGs with a C2PA manifest, animated PNGs, high-precision PNGs, and non-RGB PNGs are left intact by the optimizer. JPEG and WebP uploads are not recompressed. The separate Gelato print editor is unchanged. If Supabase still rejects an artwork upload, the admin message identifies the tier, size and bucket; check the bucket limit and the global limit in Supabase Storage. For a file that remains too large, you can export a smaller unsigned source at the same pixel dimensions, then let the helper sign the upload.
