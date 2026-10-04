# Live homepage 404 fix — October 4, 2026

## Confirmed issue

The production root returned HTTP404 and rendered "A world not found." `/index.html` redirected to `/`, so it also ended at404. Genre and utility routes responded200. The Fantasy gallery preview worked. The incomplete checkout return correctly hid its download control.

With `assets.html_handling` set to `none`, the binding needs an explicit `/index.html` request. The Worker requested `/` instead. This broke the homepage, All artwork, logo/Home links and legacy artwork redirects at their destination.

## Change

`worker.mjs` now resolves public `/` to the internal `/index.html` asset while keeping the public canonical URL `/` and existing redirects. Palette, original hero, nine genre collections and four-per-category homepage behavior are preserved. No database or payment configuration changes are required for this hotfix.

The fixture servers and Worker unit tests no longer automatically map `/` to `/index.html`. That convenience had hidden the production defect. An explicit homepage regression test, pinned Wrangler dependency, native asset-binding test and read-only live check were added.

## Deployment

Deploy the updated `worker.mjs` with the existing `public/` assets and asset-binding configuration. Preserve your existing Cloudflare Worker name, account, routes and domain bindings. This package has not deployed the fix to production; no authenticated Cloudflare deployment connection was available.

From the project root, after retaining your actual configuration:

```powershell
npm.cmd ci
npx.cmd wrangler deploy --config wrangler.jsonc
npm.cmd run test:live
```

If you deploy through Cloudflare Git integration, commit these changes and use that workflow instead. Do not deploy the project root as public assets. Verify `/` is200, displays the hero and compiled genre samples, and `/index.html` redirects to it. Existing invalid routes must remain404.

## Validation

Wrangler deployment dry run bundled the corrected Worker and located57public asset files successfully. Native Wrangler local execution was blocked in this environment by `uv_interface_addresses` (network-interface syscall restriction). The portable suite uses the stricter fixture binding; native runtime validation remains available through `npm run test:runtime` and CI.
