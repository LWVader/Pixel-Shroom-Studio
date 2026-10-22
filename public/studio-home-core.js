import {
  GENRES,
  genreUrl,
  escapeHtml,
  safePreviewUrl,
  latestArtworks,
  artworkDimensions,
} from "./catalog-core.js?v=20261022-layout";
import { FEATURED_SERIALS } from "./studio-catalog.js";
export function featuredArtworks(rows) {
  const digital = rows.filter((row) => row.category !== "NFT");
  const chosen = FEATURED_SERIALS.map((serial) =>
    digital.find((row) => row.serial_number === serial),
  ).filter(Boolean);
  for (const row of latestArtworks(digital))
    if (chosen.length < 3 && !chosen.some((x) => String(x.id) === String(row.id))) chosen.push(row);
  return chosen.slice(0, 3);
}
export function renderFeatured(rows) {
  const selected = featuredArtworks(rows);
  if (!selected.length)
    return '<p>Explore our <a class="text-link" href="/all-artwork.html">digital artwork collections →</a></p>';
  return selected
    .map((row) => {
      const slug = Object.keys(GENRES).find((slug) => GENRES[slug].name === row.category);
      const url = `${genreUrl(slug)}#genre-gallery`;
      return `<article class="featured-card"><a href="${url}"><img src="${escapeHtml(safePreviewUrl(row.preview_url))}" width="600" height="600" loading="lazy" alt="${escapeHtml(row.title)}, protected digital artwork preview"><div><p class="eyebrow">${escapeHtml(row.category)}</p><h3>${escapeHtml(row.title)}</h3><p class="artwork-size">Original image: ${escapeHtml(artworkDimensions(row))}</p><span class="text-link">Explore this artwork →</span></div></a></article>`;
    })
    .join("");
}
export function renderProductExamples(catalog) {
  const items = Array.isArray(catalog?.products) ? catalog.products : [];
  return ["canvas", "apparel"]
    .map((category) => {
      const item = items.find((item) => item.kind === category);
      const title = category === "canvas" ? "See it on your wall" : "Wear a little imagination";
      const page = category === "canvas" ? "/canvases.html" : "/apparel.html";
      return `<article class="example-card">${item ? `<a href="${page}" rel="noopener noreferrer"><img src="${escapeHtml(safePreviewUrl(item.preview_url))}" width="600" height="600" loading="lazy" alt="${escapeHtml(item.title)}, physical product preview"></a>` : '<div class="example-placeholder">Choose your artwork. Find your product.</div>'}<div><p class="eyebrow">${category === "canvas" ? "Canvas prints" : "Apparel & gifts"}</p><h3>${title}</h3><p>${item ? "Product preview. Choose a mapped variation and delivery option; Gelato fulfills the physical order after verified studio payment." : "Browse current products or ask about putting your favorite artwork on a canvas or apparel."}</p><a class="text-link" href="${item ? page : page}" ${item ? 'rel="noopener noreferrer"' : ""}>${item ? "Explore this printed product" : "Explore products"} →</a></div></article>`;
    })
    .join("");
}
export function renderProjectExample(rows) {
  const row = featuredArtworks(rows)[0];
  return row
    ? `<div class="project-screen"><div class="project-toolbar" aria-hidden="true"><span></span><span></span><span></span></div><img src="${escapeHtml(safePreviewUrl(row.preview_url))}" width="600" height="600" loading="lazy" alt="Protected artwork shown in an illustrative creative-project screen mockup"><p class="artwork-size">Original image: ${escapeHtml(artworkDimensions(row))}</p></div>`
    : '<div class="example-placeholder">Your next creative project starts here.</div>';
}
export function renderFeedback(records) {
  if (!Array.isArray(records)) return "";
  return records
    .filter(
      (row) =>
        row.published === true &&
        row.permissionGranted === true &&
        row.verifiedPurchase === true &&
        typeof row.quote === "string" &&
        row.quote.trim() &&
        typeof row.name === "string" &&
        row.name.trim(),
    )
    .slice(0, 3)
    .map(
      (row) =>
        `<figure class="customer-quote"><blockquote>${escapeHtml(row.quote.slice(0, 600))}</blockquote><figcaption>${escapeHtml(row.name.slice(0, 80))}${typeof row.product === "string" ? ` · ${escapeHtml(row.product.slice(0, 100))}` : ""}</figcaption></figure>`,
    )
    .join("");
}
