# AD Studio: full Canvix template catalog and AI tools

The existing `/admin-ad-studio/` page contains the **Browse 366 templates** and **AI creative tools** buttons. No separate Next.js deployment or PostgreSQL database is needed.

## Templates

All 366 Canvix catalog entries (122 originals and 244 variants), all 426 pages, and all 5,097 source elements are imported into editable native layers. The browser fetches the manifest and template packs on demand. Search by title or category; preview a design, fill the smart fields where offered, and apply it. Multi-page designs have a page selector. Current page edits are saved when switching pages and all pages are included in the project JSON. PNG and video export capture the selected page. Original template dimensions are preserved, with odd pixel dimensions rounded to an even number for video compatibility. Social presets remain available. Rendering is adapted to Canvas 2D, not Canvix's React/Konva engine, so minor differences in fonts, typography, or shape rendering may occur. Fonts load from the existing font catalog when network access is available.

## AI tools

The new admin-only Worker route exposes these operations:
- Magic Write, translation, campaign/speaker notes
- AI design generator and design assistant (editable text/shape layout proposals)
- AI brand palette
- AI image generation, image editing, and AI-assisted background removal
- Image alt text and Magic Layers (approximate reconstruction of editable text/shapes and source-image crops)
- Optional AI video generation, preview, download, and use as a finished clip in the existing publishing workflow

The UI requires review and an explicit apply action. Design/assistant outputs replace the current creative; save the existing project first. Generated video is only attached to the publishing workspace; posting still requires explicit publication. Background removal is generative editing, not a guaranteed pixel-exact cutout. AI features depend on the configured provider and model capabilities, and no chargeable AI provider calls are made by automated tests.

### Cloudflare Worker setup

Keep the provider key server-side:

```powershell
npx.cmd wrangler secret put AD_STUDIO_AI_KEY
```

In Worker Settings → Variables and Secrets, configure these variables using model IDs supported by your provider/account:

| Name | Purpose |
| --- | --- |
| AD_STUDIO_AI_TEXT_MODEL | Text, design generation and palette tools |
| AD_STUDIO_AI_VISION_MODEL | Image analysis, alt text, Magic Layers |
| AD_STUDIO_AI_IMAGE_MODEL | Image generation/editing and background removal |
| AD_STUDIO_AI_VIDEO_MODEL | Optional asynchronous video jobs |
| AD_STUDIO_AI_BASE_URL | Optional OpenAI-compatible HTTPS base URL; defaults to https://api.openai.com/v1 |

The Worker also accepts existing OPENAI_API_KEY or ZAI_API_KEY and compatible ZAI_BASE_URL/model variables. No key is required for templates or other non-AI editing. AI operations stay disabled until the relevant model and key are configured. Requests use the OpenAI-compatible chat completions, image generation/edit, and optional video APIs; providers must support those endpoints and return the documented result formats. Credentials never appear in browser responses. Prompts and explicitly selected artwork are submitted to the provider, which may charge for usage.

No Buffer, Cloudinary, Stripe, Supabase or D1 settings are changed.

## Updating template data from upstream

```sh
node tools/import-canvix-templates.mjs ../canvix-pixel
npm run build:ad-studio
npm test
```

Source: LWVader/canvix-pixel commit 22887a14e1581ae8fd3f3e515fb574ad5da27935 (MIT; see public/admin-ad-studio/canvix/LICENSE.txt).
