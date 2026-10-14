# Readable source, minified deployment

Continue editing public/_.js and public/_.css normally. npm run build copies the public directory into dist/public and minifies JavaScript and CSS there, keeping filenames, module imports and HTML links unchanged. Other assets, including images and HTML, are copied unchanged. No public source maps are generated. dist is generated output, excluded from Git and Prettier.

Install the updated dependencies and deploy:

```powershell
npm.cmd ci
npx.cmd wrangler deploy
```

Wrangler automatically runs the build and serves dist/public. This also applies to Git-connected deployments using the updated wrangler.jsonc. Keep your existing Worker secrets and bindings. Do not deploy public directly: it contains the readable source files. npm.cmd run build can also generate the output independently.

The Worker bundle is minified too. Browser filenames, eBay links, routes, fonts and colors remain the same. npm.cmd run test:e2e builds and tests the generated deployment assets. Semrush should see the minified files after deployment and a new crawl; this only addresses your own JS/CSS, not third-party files loaded from other domains.

## llms.txt

public/llms.txt provides a short studio overview and links to the public collections, shop and help pages. It is copied unchanged and served at /llms.txt. Maintain it when the site structure or offerings change. It supplements the sitemap and robots.txt; it does not promise improved rankings or AI visibility.
