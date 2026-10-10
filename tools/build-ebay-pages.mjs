// Validate live storefront templates without reintroducing stale snapshots.
import fs from "node:fs/promises";
for (const slug of ["canvases", "apparel"]) {
  const html = await fs.readFile(new URL(`../public/${slug}.html`, import.meta.url), "utf8");
  if (!html.includes('id="ebay-listings"') || !html.includes('src="/ebay-store.js"'))
    throw new Error(`Missing live feed in ${slug}`);
}
console.log(
  "Live eBay templates validated. Listings refresh through the Worker; no rebuild is required.",
);
