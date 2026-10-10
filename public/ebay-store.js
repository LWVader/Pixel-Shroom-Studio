import { validateCatalog, collectionMarkup, unavailableMarkup, itemList } from "./ebay-core.js";
const category = document.body.dataset.ebayCategory;
const listings = document.getElementById("ebay-listings");
const status = document.getElementById("ebay-status");
let pending = false;
async function refresh() {
  if (pending || document.hidden) return;
  pending = true;
  try {
    const response = await fetch("/api/ebay-listings", {
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error("Feed unavailable");
    const catalog = await response.json();
    const items = validateCatalog(catalog);
    listings.innerHTML = collectionMarkup(items, category);
    status.textContent = "Listings refreshed. Prices and availability are confirmed on eBay.";
    updateSchema(items);
  } catch {
    listings.innerHTML = unavailableMarkup();
    status.textContent =
      "Could not refresh listings. Open our eBay store for current availability.";
    updateSchema([]);
  } finally {
    pending = false;
  }
}
function updateSchema(items) {
  const node = document.getElementById("ebay-schema");
  const schema = JSON.parse(node.textContent);
  schema.mainEntity = itemList(items, category);
  node.textContent = JSON.stringify(schema);
}
if (listings && status && ["canvas", "apparel"].includes(category)) {
  refresh();
  setInterval(refresh, 300000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
}
