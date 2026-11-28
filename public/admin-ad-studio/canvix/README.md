# Canvix editor primitives

Source: https://github.com/LWVader/canvix-pixel, commit 22887a14e1581ae8fd3f3e515fb574ad5da27935.
MIT copyright Ashiq Hussain Mir; see LICENSE.txt.

- shapes.ts and text-fit.ts: upstream pure geometry and fitting routines.
- element-animation.ts: upstream per-element timing routines extracted from animations.ts, with local types.
- The Pixel Shroom layer adapter uses these in the existing Canvas 2D renderer, so previews, PNG captures, and MP4 exports share a single rendering path. No Next.js server, PostgreSQL database, or new public routes are required.
