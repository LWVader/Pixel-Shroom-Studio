// Regenerate the two HTML storefronts from reviewed public eBay listing metadata.
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import { validateCatalog, collectionMarkup, itemList } from "./ebay-catalog.mjs";
const publicRoot = new URL("../public/", import.meta.url);
const catalog = JSON.parse(await fs.readFile(new URL("ebay-listings.json", publicRoot), "utf8"));
const items = validateCatalog(catalog);
const writes = [];
for (const [slug, category] of [
  ["canvases", "canvas"],
  ["apparel", "apparel"],
]) {
  const url = new URL(`${slug}.html`, publicRoot);
  let html = await fs.readFile(url, "utf8");
  const markers = /<!-- EBAY-LISTINGS-START -->[\s\S]*?<!-- EBAY-LISTINGS-END -->/;
  if (!markers.test(html)) throw new Error(`Listing markers are missing from ${slug}.html.`);
  html = html.replace(
    markers,
    () =>
      `<!-- EBAY-LISTINGS-START -->\n${collectionMarkup(items, category)}\n<!-- EBAY-LISTINGS-END -->`,
  );
  html = html.replace(
    /(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/,
    (_, open, raw, close) => {
      const schema = JSON.parse(raw);
      schema.mainEntity = itemList(items, category);
      return open + JSON.stringify(schema).replaceAll("<", "\\u003c") + close;
    },
  );
  const options = await resolveConfig(fileURLToPath(url));
  writes.push({ url, html: await format(html, { ...options, filepath: fileURLToPath(url) }) });
}
for (const { url, html } of writes) await fs.writeFile(url, html);
console.log(
  `Updated storefronts with ${items.length} reviewed lwvader listing(s). No external requests or uploads were made.`,
);
