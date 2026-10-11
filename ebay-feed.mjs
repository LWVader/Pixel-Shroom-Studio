import { XMLParser, XMLValidator } from "fast-xml-parser";
import { SELLER, STORE_URL, validateCatalog } from "./public/ebay-core.js";
import { collectionMarkup, unavailableMarkup, itemList } from "./public/ebay-core.js";
export const REFRESH_SECONDS = 300;
const VERSION = "1487";
const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
});
let state;
const array = (value) =>
  value == null || value === "" ? [] : Array.isArray(value) ? value : [value];
export function parseTradingResponse(xml, call) {
  if (
    typeof xml !== "string" ||
    xml.length > 8000000 ||
    /<!DOCTYPE|<!ENTITY/i.test(xml) ||
    XMLValidator.validate(xml) !== true
  )
    throw new Error("Invalid eBay XML response");
  const result = parser.parse(xml)[`${call}Response`];
  if (
    !result ||
    !["Success", "Warning"].includes(result.Ack) ||
    array(result.Errors).some((error) => error.SeverityCode === "Error")
  )
    throw new Error("eBay seller request failed");
  return result;
}
export function projectItems(rows, now = Date.now()) {
  const items = [],
    ids = new Set();
  for (const row of rows) {
    const id = String(row.ItemID || ""),
      title = row.Title;
    if (
      !/^\d{12}$/.test(id) ||
      ids.has(id) ||
      typeof title !== "string" ||
      !title.trim() ||
      row.QuantityAvailable === "0" ||
      (row.ListingDetails?.EndTime && Date.parse(row.ListingDetails.EndTime) <= now)
    )
      continue;
    try {
      const preview = new URL(row.PictureDetails?.GalleryURL);
      // Older Trading responses can use HTTP for the same public eBay image host.
      if (preview.hostname === "i.ebayimg.com" && preview.protocol === "http:")
        preview.protocol = "https:";
      const item = {
        itemId: id,
        seller: SELLER,
        category: /\bcanvas(?:es)?\b/i.test(title) ? "canvas" : "apparel",
        title,
        imageUrl: preview.href,
        active: true,
      };
      validateCatalog({ seller: SELLER, storeUrl: STORE_URL, items: [item] });
      items.push(item);
      ids.add(id);
    } catch {
      /* Invalid public previews cannot be displayed. */
    }
  }
  return items;
}
export async function readEbayListings(env) {
  if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET || !env.EBAY_REFRESH_TOKEN)
    throw new Error("eBay seller feed is not configured");
  const fetcher = env.EBAY_FETCH || fetch;
  if (
    !state ||
    state.id !== env.EBAY_CLIENT_ID ||
    state.secret !== env.EBAY_CLIENT_SECRET ||
    state.refresh !== env.EBAY_REFRESH_TOKEN ||
    state.fetcher !== fetcher
  )
    state = {
      id: env.EBAY_CLIENT_ID,
      secret: env.EBAY_CLIENT_SECRET,
      refresh: env.EBAY_REFRESH_TOKEN,
      fetcher,
    };
  const current = state;
  if (current.catalog && Date.now() - current.loadedAt < REFRESH_SECONDS * 1000)
    return current.catalog;
  if (current.pending) return current.pending;
  current.pending = (async () => {
    const signal = AbortSignal.timeout(18000);
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
          grant_type: "refresh_token",
          refresh_token: env.EBAY_REFRESH_TOKEN,
          scope: "https://api.ebay.com/oauth/api_scope",
        }),
      });
      if (!response.ok) throw new Error("eBay seller authorization unavailable");
      const data = await response.json();
      if (
        typeof data.access_token !== "string" ||
        !data.access_token ||
        !Number.isFinite(Number(data.expires_in)) ||
        Number(data.expires_in) <= 0
      )
        throw new Error("Invalid eBay token response");
      current.token = data.access_token;
      current.tokenUntil = Date.now() + Math.max(0, Number(data.expires_in) - 60) * 1000;
      current.verifiedToken = null;
      return current.token;
    }
    async function trading(call, fields) {
      const body = `<?xml version="1.0" encoding="utf-8"?><${call}Request xmlns="urn:ebay:apis:eBLBaseComponents"><Version>${VERSION}</Version>${fields}</${call}Request>`;
      async function request() {
        return fetcher("https://api.ebay.com/ws/api.dll", {
          method: "POST",
          signal,
          headers: {
            "Content-Type": "text/xml; charset=utf-8",
            "X-EBAY-API-CALL-NAME": call,
            "X-EBAY-API-SITEID": "0",
            "X-EBAY-API-COMPATIBILITY-LEVEL": VERSION,
            "X-EBAY-API-IAF-TOKEN": await token(),
          },
          body,
        });
      }
      let response = await request();
      if (response.status === 401) {
        current.token = null;
        response = await request();
      }
      if (!response.ok) throw new Error("eBay seller API unavailable");
      const xml = await response.text();
      // Trading often returns expired-auth errors inside HTTP 200 XML.
      let result;
      try {
        result = parseTradingResponse(xml, call);
      } catch (error) {
        if (/<ErrorCode>\s*(931|932|16110)\s*<\/ErrorCode>/.test(xml)) {
          current.token = null;
          response = await request();
          if (!response.ok) throw new Error("eBay seller API unavailable");
          result = parseTradingResponse(await response.text(), call);
        } else throw error;
      }
      return result;
    }
    async function verifySeller() {
      const access = await token();
      if (current.verifiedToken === access) return;
      const identity = await trading("GetUser", "<OutputSelector>User.UserID</OutputSelector>");
      if (identity.User?.UserID?.toLowerCase() !== SELLER)
        throw new Error("The refresh token must belong to lwvader");
      current.verifiedToken = current.token;
    }
    const rows = [];
    let expectedTotal;
    for (let page = 1; page <= 125; page++) {
      await verifySeller();
      const selectors = [
        "Ack",
        "Errors",
        "ActiveList.ItemArray.Item.ItemID",
        "ActiveList.ItemArray.Item.Title",
        "ActiveList.ItemArray.Item.PictureDetails.GalleryURL",
        "ActiveList.ItemArray.Item.QuantityAvailable",
        "ActiveList.ItemArray.Item.ListingDetails.EndTime",
        "ActiveList.PaginationResult",
      ];
      const fields = `<DetailLevel>ReturnAll</DetailLevel><ActiveList><Include>true</Include><IncludeNotes>false</IncludeNotes><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination><Sort>StartTime</Sort></ActiveList><HideVariations>true</HideVariations><SoldList><Include>false</Include></SoldList><UnsoldList><Include>false</Include></UnsoldList><ScheduledList><Include>false</Include></ScheduledList><SellingSummary><Include>false</Include></SellingSummary>${selectors.map((name) => `<OutputSelector>${name}</OutputSelector>`).join("")}`;
      const data = await trading("GetMyeBaySelling", fields);
      // A renewed token must be verified before any seller inventory is released.
      await verifySeller();
      const paging =
        data.ActiveList?.PaginationResult ||
        (page === 1 && !data.ActiveList
          ? { TotalNumberOfPages: "0", TotalNumberOfEntries: "0" }
          : null);
      const pages = Number(paging?.TotalNumberOfPages),
        total = Number(paging?.TotalNumberOfEntries);
      if (
        !Number.isInteger(pages) ||
        pages < 0 ||
        pages > 125 ||
        !Number.isInteger(total) ||
        total < 0 ||
        total >= 25000
      )
        throw new Error("Invalid or truncated seller inventory");
      if (expectedTotal !== undefined && expectedTotal !== total)
        throw new Error("Seller inventory changed during pagination; retry next refresh");
      expectedTotal = total;
      const entries = array(data.ActiveList?.ItemArray?.Item);
      if (entries.length > 200 || (total > rows.length && !entries.length))
        throw new Error("Incomplete seller inventory");
      rows.push(...entries);
      if (page >= pages) break;
    }
    if (
      rows.length !== expectedTotal ||
      new Set(rows.map((row) => row.ItemID)).size !== rows.length
    )
      throw new Error("Incomplete seller inventory");
    const catalog = {
      seller: SELLER,
      storeUrl: STORE_URL,
      items: projectItems(rows),
      updatedAt: new Date().toISOString(),
      refreshAfterSeconds: REFRESH_SECONDS,
      source: "seller-active-listings",
      activeListingCount: rows.length,
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
