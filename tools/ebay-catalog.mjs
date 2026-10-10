// Public listing metadata only. No payment, fulfillment or image-upload integrations.
import { escapeHtml } from "../public/catalog-core.js";
export const SELLER = "lwvader";
export const STORE_URL = "https://www.ebay.com/sch/i.html?_ssn=lwvader";
export const CATEGORIES = ["canvas", "apparel"];

export function validateCatalog(catalog) {
  if (catalog.seller !== SELLER || catalog.storeUrl !== STORE_URL || !Array.isArray(catalog.items))
    throw new Error("The catalog must use the configured lwvader eBay seller.");
  const ids = new Set();
  return catalog.items
    .filter((item) => item.active === true)
    .map((item) => {
      if (
        item.seller !== SELLER ||
        !/^[0-9]{12}$/.test(String(item.itemId)) ||
        ids.has(String(item.itemId))
      )
        throw new Error("Every active item needs a unique eBay item ID and the configured seller.");
      if (
        !CATEGORIES.includes(item.category) ||
        typeof item.title !== "string" ||
        !item.title.trim()
      )
        throw new Error("Every active item needs a title and canvas/apparel category.");
      const image = new URL(item.imageUrl);
      if (
        image.protocol !== "https:" ||
        image.hostname !== "i.ebayimg.com" ||
        image.username ||
        image.password ||
        image.port
      )
        throw new Error("Use an existing public eBay listing preview image.");
      ids.add(String(item.itemId));
      return {
        itemId: String(item.itemId),
        seller: SELLER,
        category: item.category,
        title: item.title.trim(),
        imageUrl: image.href,
        url: `https://www.ebay.com/itm/${item.itemId}`,
      };
    });
}
export function collectionMarkup(items, category) {
  const selected = items.filter((item) => item.category === category);
  if (!selected.length)
    return `<div class="ebay-empty"><p>No ${category === "canvas" ? "canvas" : "apparel or gift"} listings are featured here yet.</p><a class="button" href="${STORE_URL}" rel="noopener noreferrer">Browse lwvader’s current eBay listings ↗</a></div>`;
  return `<div class="print-grid">${selected
    .map(
      (item) => `<article class="ebay-product">
    <a href="${item.url}" rel="noopener noreferrer" aria-label="${escapeHtml(item.title)} on eBay"><img src="${escapeHtml(item.imageUrl)}" width="500" height="500" loading="lazy" alt="${escapeHtml(item.title)}"></a>
    <h3><a href="${item.url}" rel="noopener noreferrer">${escapeHtml(item.title)}</a></h3>
    <p>Sold by lwvader on eBay. See the listing for current price and product options.</p>
    <a class="button" href="${item.url}" rel="noopener noreferrer">View and buy on eBay ↗</a>
  </article>`,
    )
    .join("\n")}</div>`;
}
export function itemList(items, category) {
  const selected = items.filter((item) => item.category === category);
  return {
    "@type": "ItemList",
    numberOfItems: selected.length,
    itemListElement: selected.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: item.url,
      name: item.title,
    })),
  };
}
