# Artwork size and navigation update

Copy the included files over the same paths in your project. Keep the existing payment configuration and secrets.

Original image dimensions now appear on each artwork card, featured card and creative-project example. Admin uploads already capture decoded original dimensions. Existing records use the metadata enabled by the earlier `supabase/migrations/202610140001_buyer_metadata_and_genre_review.sql` migration; run that migration once if you have not already. Unknown original dimensions are labeled honestly rather than using resized preview dimensions.

All artwork search bars are removed. Featured links open the full associated genre collection. Genre navigation uses 16px on all screen sizes.

Run `npm.cmd ci`, `npm.cmd run build`, then `npx.cmd wrangler deploy` using your existing deployment setup. Source JavaScript and CSS remain readable; the build produces minified assets.
