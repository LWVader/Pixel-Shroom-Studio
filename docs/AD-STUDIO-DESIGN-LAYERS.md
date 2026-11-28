# Pixel Shroom AD Studio — Canvix layer integration

The existing admin-protected `/admin-ad-studio/` route now includes a three-pane editor. No separate Canvix application, Supabase migration, Worker binding, or API keys are required for this upgrade.

- Choose **Marketing creative** or **Pop-out editor** to retain the original templates and character effects. Extra layers stack over them.
- Choose **Freeform design** for a canvas/background with independently editable elements. Remove the existing artwork in Ad settings for an empty canvas.
- Add text, shapes, and uploaded images. Select a layer from the list or drag it directly in the preview. Position/size fields are also available for keyboard editing.
- Text auto-fits its box; shapes and image masks use Canvix geometry. Layer animations use Canvix per-element timing. The old scene animations remain in their original modes.
- Layer-only undo/redo, duplication, visibility and stacking are available. JSON project files include layers; earlier projects open without extra layers.
- PNG captures, rendered videos and the existing Buffer/Cloudinary publishing service use the same scene canvas. No publisher, database, authentication, or billing changes are included.

This is a native, selective Canvix integration, not a complete port of its Next.js application. It does not yet include the full template library, server-side project database, collaboration, or AI tools.

Upstream license and provenance: `public/admin-ad-studio/canvix/`.

## Build and verify

```sh
npm ci
npm run build:ad-studio
npm run test:api
npm run test:install-browsers
npm run test:e2e
```

Deploy the existing Pixel Shroom Worker after review. The public URL remains unchanged.
