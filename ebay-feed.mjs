import { SELLER, STORE_URL, validateCatalog } from "./public/ebay-core.js";
export const REFRESH_SECONDS = 300;
// One state per credential/fetcher combination; credentials never reach public responses.
let state;
function categoryFor(title) {
  if (/\bcanvas(?:es)?\b/i.test(title)) return "canvas";
  if (
    /\b(t[ -]?shirts?|shirts?|tees?|hoodies?|sweatshirts?|mugs?|totes?|bags?|hats?|caps?|gifts?|apparel)\b/i.test(
      title,
    )
  )
    return "apparel";
  return null;
}
export function projectItems(rows, now = Date.now()) {
  const items = [],
    ids = new Set();
  for (const row of rows) {
    const id = String(row.legacyItemId || row.itemId?.split("|")[1] || "");
    const category = categoryFor(row.title || "");
    if (
      row.seller?.username?.toLowerCase() !== SELLER ||
      !category ||
      !/^\d{12}$/.test(id) ||
      ids.has(id) ||
      (row.itemEndDate && Date.parse(row.itemEndDate) <= now)
    )
      continue;
    try {
      const item = {
        itemId: id,
        seller: SELLER,
        category,
        title: row.title,
        imageUrl: row.image?.imageUrl,
        active: true,
      };
      validateCatalog({ seller: SELLER, storeUrl: STORE_URL, items: [item] });
      items.push(item);
      ids.add(id);
    } catch {
      /* A malformed preview is never displayed. */
    }
  }
  return items;
}
export async function readEbayListings(env) {
  if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET)
    throw new Error("eBay feed is not configured");
  const fetcher = env.EBAY_FETCH || fetch;
  if (
    !state ||
    state.id !== env.EBAY_CLIENT_ID ||
    state.secret !== env.EBAY_CLIENT_SECRET ||
    state.fetcher !== fetcher
  )
    state = { id: env.EBAY_CLIENT_ID, secret: env.EBAY_CLIENT_SECRET, fetcher };
  const current = state;
  if (current.catalog && Date.now() - current.loadedAt < REFRESH_SECONDS * 1000)
    return current.catalog;
  if (current.pending) return current.pending;
  current.pending = (async () => {
    const signal = AbortSignal.timeout(15000);
    async function token() {
      if (current.token && Date.now() < current.tokenUntil) return current.token;
      const response = await fetcher("https://api.ebay.com/identity/v1/oauth2/token", {
        method: "POST",
        signal,
        headers: {
          Authorization: `Basic ${btoa(env.EBAY_CLIENT_ID + ":" + env.EBAY_CLIENT_SECRET)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          scope: "https://api.ebay.com/oauth/api_scope",
        }),
      });
      if (!response.ok) throw new Error("eBay authorization unavailable");
      const data = await response.json();
      if (!data.access_token || !Number.isFinite(Number(data.expires_in)))
        throw new Error("Invalid eBay token response");
      current.token = data.access_token;
      current.tokenUntil = Date.now() + Math.max(0, Number(data.expires_in) - 60) * 1000;
      return current.token;
    }
    const rows = [];
    for (let offset = 0; offset < 10000; offset += 200) {
      const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
      url.searchParams.set(
        "q",
        "(canvas,shirt,tee,hoodie,sweatshirt,mug,tote,bag,hat,cap,gift,apparel)",
      );
      url.searchParams.set("filter", `sellers:{${SELLER}}`);
      url.searchParams.set("limit", "200");
      url.searchParams.set("offset", String(offset));
      async function search() {
        return fetcher(url.href, {
          signal,
          headers: {
            Authorization: `Bearer ${await token()}`,
            "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
          },
        });
      }
      let response = await search();
      if (response.status === 401) {
        current.token = null;
        response = await search();
      }
      if (!response.ok) throw new Error("eBay listings unavailable");
      const data = await response.json();
      if (
        data.errors?.length ||
        !Number.isFinite(data.total) ||
        (data.total > 0 && !Array.isArray(data.itemSummaries))
      )
        throw new Error("Invalid eBay search response");
      if (data.total > 10000) throw new Error("Catalog exceeds supported search window");
      rows.push(...(data.itemSummaries || []));
      if (offset + 200 >= data.total) break;
      if (!data.itemSummaries?.length) throw new Error("Incomplete eBay search response");
    }
    const catalog = {
      seller: SELLER,
      storeUrl: STORE_URL,
      items: projectItems(rows),
      updatedAt: new Date().toISOString(),
      refreshAfterSeconds: REFRESH_SECONDS,
    };
    current.catalog = catalog;
    current.loadedAt = Date.now();
    return catalog;
  })();
  try {
    return await current.pending;
  } finally {
    current.pending = null;
  }
}
export function renderEbayPage(html, category, catalog) {
  const items = catalog ? validateCatalog(catalog) : [];
  return html
    .replace(
      "Checking current eBay listings…",
      catalog
        ? "Current eBay listings. Prices and availability are confirmed on eBay."
        : "Could not refresh listings. Open our eBay store for current availability.",
    )
    .replace(
      /<!-- EBAY-LISTINGS-START -->[\s\S]*?<!-- EBAY-LISTINGS-END -->/,
      () =>
        `<!-- EBAY-LISTINGS-START -->${catalog ? collectionMarkup(items, category) : unavailableMarkup()}<!-- EBAY-LISTINGS-END -->`,
    )
    .replace(
      /(<script id="ebay-schema" type="application\/ld\+json">)([\s\S]*?)(<\/script>)/,
      (_, open, raw, close) => {
        const schema = JSON.parse(raw);
        schema.mainEntity = itemList(items, category);
        return open + JSON.stringify(schema).replaceAll("<", "\\u003c") + close;
      },
    );
}
import { collectionMarkup, unavailableMarkup, itemList } from "./public/ebay-core.js";
