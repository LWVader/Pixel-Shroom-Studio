import fs from "node:fs/promises";
for (const slug of ["canvases", "apparel"]) {
  const html = await fs.readFile(new URL(`../public/${slug}.html`, import.meta.url), "utf8");
  if (!html.includes('id="print-products"') || !html.includes("/print-store.js"))
    throw Error("Physical storefront is not migrated: " + slug);
}
console.log(
  "Gelato storefront templates validated. Product UIDs and private print files are configured in Owner access.",
);
