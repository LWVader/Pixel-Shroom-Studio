# Demo tier images

These six supplied finished JPEG designs are used automatically by `npm.cmd run demo`.

| File          | Tier                           |
| ------------- | ------------------------------ |
| standard.jpg  | Standard — unframed            |
| silver.jpg    | Silver — silver frame          |
| gold.jpg      | Gold — gold frame              |
| emerald.jpg   | Emerald — green gemstone frame |
| sapphire.jpg  | Sapphire — blue gemstone frame |
| prismatic.jpg | Prismatic — rainbow frame      |

Copy this folder and the updated `tools/demo-server.mjs` into the same paths in your testing branch, then stop and restart `npm.cmd run demo`. The existing demo controls let you select each tier and replay its reveal.

If `DEMO_TIER_DIR` is already set, it overrides this folder. Remove that environment variable to use the bundled images, or point it at this folder. The source JPEGs are preserved; only the demo copy-identification metadata and private signed receipt are generated. No new borders or image effects are applied.

This update changes local demo runs only. No database migration, live listing upload, Modal deployment or payment configuration change is required.
