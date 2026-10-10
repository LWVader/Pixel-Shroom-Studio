// Public eBay previews only; shared by the Worker and browser.
import { escapeHtml } from "./catalog-core.js";
export const SELLER = "lwvader";
export const STORE_URL = "https://www.ebay.com/sch/i.html?_ssn=lwvader";
export const CATEGORIES = ["canvas", "apparel"];
export function validateCatalog(catalog) {
  if (catalog.seller !== SELLER || catalog.storeUrl !== STORE_URL || !Array.isArray(catalog.items))
    throw new Error("Invalid seller catalog");
  const ids = new Set();
  return catalog.items
    .filter((item) => item.active === true)
    .map((item) => {
      const image = new URL(item.imageUrl);
      if (
        item.seller !== SELLER ||
        !/^\d{12}$/.test(String(item.itemId)) ||
        ids.has(String(item.itemId)) ||
        !CATEGORIES.includes(item.category) ||
        typeof item.title !== "string" ||
        !item.title.trim() ||
        image.protocol !== "https:" ||
        image.hostname !== "i.ebayimg.com" ||
        image.username ||
        image.password ||
        image.port
      )
        throw new Error("Invalid listing");
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
    return `<div class="ebay-empty"><p>No current ${category === "canvas" ? "canvas" : "apparel or gift"} listings were found.</p><a class="button" href="${STORE_URL}" rel="noopener noreferrer">Browse lwvader’s current eBay listings ↗</a></div>`;
  return `<div class="print-grid">${selected.map((item) => `<article class="ebay-product"><a href="${item.url}" rel="noopener noreferrer" aria-label="${escapeHtml(item.title)} on eBay"><img src="${escapeHtml(item.imageUrl)}" width="500" height="500" loading="lazy" alt="${escapeHtml(item.title)}"></a><h3><a href="${item.url}" rel="noopener noreferrer">${escapeHtml(item.title)}</a></h3><p>Sold by lwvader on eBay. See the listing for current price and product options.</p><a class="button" href="${item.url}" rel="noopener noreferrer">View and buy on eBay ↗</a></article>`).join("\n")}</div>`;
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
export function unavailableMarkup() {
  return `<div class="ebay-empty"><p>Live listings are temporarily unavailable.</p><a class="button" href="${STORE_URL}" rel="noopener noreferrer">Browse lwvader’s current eBay listings ↗</a></div>`;
}
