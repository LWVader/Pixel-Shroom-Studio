# Homepage and buyer information update

This patch preserves the palette, Georgia font, fantasy-city hero, nine genre URLs and the 14 newest artworks regardless of genre. It adds three shopping paths, three featured digital previews, current eBay product examples, a labeled protected creative-project mockup, the LWVader introduction, buyer information and personally managed email signup requests. Empty articles and customer feedback are hidden.

## Apply

1. Run supabase/migrations/202610140001_buyer_metadata_and_genre_review.sql once in the Supabase SQL Editor (or deploy this migration through your normal process). This adds public file metadata and updates six reviewed genre assignments; it does not touch payments, originals, signatures, orders or usage permissions.
2. Copy the update files into the project, preserving paths. Run npm.cmd ci and npx.cmd wrangler deploy. The existing minification build remains enabled.
3. Verify the homepage, genre links, a protected preview, the Stripe button and the eBay product links. Do not reconfigure payment keys or webhook handlers.

Stripe continues to use create-checkout, verified payment fulfillment and private downloads. Physical products continue linking directly to eBay. NFT purchases remain disabled. There are no new payment functions, order APIs or artwork uploads.

## Original specifications

File format comes from original MIME metadata/signature records, never from the public preview's extension. The migration copies existing admin-registered source-image dimensions into separate public metadata fields, explicitly marked registered. These registered values have not been independently decoded from private originals during this update. Confirm questionable values in the admin or by reuploading the unchanged original. Unknown specifications are labeled unknown; preview dimensions are never substituted silently.

New original uploads record decoded original dimensions and MIME type separately from resized preview dimensions. Existing originals, signatures and paid download paths are preserved. Apply the migration before using the updated admin to save listings. The public gallery has a legacy-query fallback if the migration has not yet been applied, but full original dimensions require it.

## Genre review

All 44 published protected previews were reviewed. Six old assignments change:

| Artwork                                      | Old genre | New genre    |
| -------------------------------------------- | --------- | ------------ |
| Haunted Lightning Portal, LWV-1076123371     | Portrait  | Dark Fantasy |
| Neon Bone Portal, LWV-1317546991             | Portrait  | Horror       |
| Crowned Orc Over Cosmic Seas, LWV-8400430249 | Portrait  | Fantasy      |
| Realm of the Sacred Beasts, LWV-5714104482   | Portrait  | Fantasy      |
| Storm of the Reaper, LWV-6821652269          | Portrait  | Dark Fantasy |
| Storm at Dusk, LWV-7332630323                | Fantasy   | Dark Fantasy |

The other 38 assignments remain. public/studio-catalog.js applies the same corrections to public display while old assignments are present; the migration persists them in the catalog. No additional genre pages are created. FEATURED_SERIALS in the same file controls the curated picks, with published digital artwork as a fallback.

## Email requests and customer feedback

Signup requests use the existing submit-message function and appear in the existing admin inbox. They record the chosen topics and explicit consent. Existing owner email alerts continue if configured. This is a personally managed list, not a newly connected automated mailing service; no automatic customer email or confirmation delivery is claimed. Honor selected topics and unsubscribe requests when sending updates. NFT notification links open the same form with the NFT topic selected.

public/studio-feedback.json starts empty. No testimonials, ratings or sales claims are fabricated. Add a quote only after verifying a purchase and obtaining publication permission, using fields name, quote, product, verifiedPurchase:true, permissionGranted:true and published:true. Keep customer email addresses and private order details out of this public file. The section appears only when eligible quotes exist. Published journal entries appear only when they have a title and body; errors or an empty list leave the section hidden.

Product examples use existing eBay listing previews and direct purchase links, not uploaded originals. The creative-project illustration uses a protected preview and is labeled as a mockup. All signup and checkout tests use fixtures; no real customers, payments or messages were generated during testing.
