import { it, expect } from "vitest";
import fs from "node:fs";
import { load } from "cheerio";
import { PGlite } from "@electric-sql/pglite";
import {
  validateCatalog,
  collectionMarkup,
  itemList,
  STORE_URL,
} from "../../tools/ebay-catalog.mjs";
const actualCatalog = JSON.parse(fs.readFileSync("public/ebay-listings.json", "utf8"));
const catalog = {
  seller: "lwvader",
  storeUrl: "https://www.ebay.com/sch/i.html?_ssn=lwvader",
  verifiedAt: "2026-10-10",
  items: [
    {
      itemId: "198704183258",
      seller: "lwvader",
      category: "canvas",
      title: "Cute Dancing Banana Canvas | Matte Stretched Wall Art",
      imageUrl: "https://i.ebayimg.com/images/g/-FYAAeSwUKVqyk1a/s-l500.jpg",
      active: true,
    },
  ],
};
it("includes only reviewed lwvader items with canonical eBay destinations", () => {
  const reviewed = validateCatalog(actualCatalog);
  expect(reviewed.every((item) => item.seller === "lwvader")).toBe(true);
  const items = validateCatalog(catalog);
  expect(items).toHaveLength(1);
  expect(items[0].itemId).toBe("198704183258");
  expect(items[0].url).toBe("https://www.ebay.com/itm/198704183258");
  expect(items[0].seller).toBe("lwvader");
  expect(items[0].category).toBe("canvas");
});
it("rejects other sellers, invalid IDs, duplicate items and unsafe preview hosts", () => {
  for (const patch of [
    { seller: "other" },
    { itemId: "javascript:alert(1)" },
    { category: "other" },
    { imageUrl: "https://evil.example/image.jpg" },
    { imageUrl: "https://i.ebayimg.com.evil.example/image.jpg" },
    { imageUrl: "https://user:pass@i.ebayimg.com/image.jpg" },
    { imageUrl: "http://i.ebayimg.com/image.jpg" },
  ])
    expect(() =>
      validateCatalog({ ...catalog, items: [{ ...catalog.items[0], ...patch }] }),
    ).toThrow();
  expect(() =>
    validateCatalog({ ...catalog, items: [catalog.items[0], catalog.items[0]] }),
  ).toThrow();
  expect(() => validateCatalog({ ...catalog, seller: "other" })).toThrow();
  expect(() =>
    validateCatalog({ ...catalog, storeUrl: "https://www.ebay.com/sch/i.html?_ssn=other" }),
  ).toThrow();
});
it("hides inactive items and never fills an empty category with unrelated listings", () => {
  expect(
    validateCatalog({ ...catalog, items: [{ ...catalog.items[0], active: false }] }),
  ).toHaveLength(0);
  const items = validateCatalog(catalog);
  expect(itemList(items, "canvas").numberOfItems).toBe(1);
  expect(itemList(items, "apparel").numberOfItems).toBe(0);
  const $ = load(collectionMarkup(items, "apparel"));
  expect($(".ebay-product")).toHaveLength(0);
  expect($("a").attr("href")).toBe(STORE_URL);
});
it("escapes listing titles and keeps all product links directly on eBay", () => {
  const items = validateCatalog({
    ...catalog,
    items: [{ ...catalog.items[0], title: '<script>alert("test")</script>' }],
  });
  const $ = load(collectionMarkup(items, "canvas"));
  expect($("script")).toHaveLength(0);
  expect($("h3").text()).toContain("<script>");
  for (const a of $("a").toArray())
    expect($(a).attr("href")).toBe("https://www.ebay.com/itm/198704183258");
  expect($("form,button,[download]")).toHaveLength(0);
});
it("renders crawlable pages without checkout scripts or fake offer data", () => {
  const actualItems = validateCatalog(actualCatalog);
  for (const [slug, category] of [
    ["canvases", "canvas"],
    ["apparel", "apparel"],
  ]) {
    const count = 0;
    const $ = load(fs.readFileSync(`public/${slug}.html`, "utf8"));
    expect($("h1")).toHaveLength(1);
    expect($(".ebay-product")).toHaveLength(count);
    expect($("form,button,[download]")).toHaveLength(0);
    const schema = JSON.parse($("#ebay-schema").text());
    expect(schema.mainEntity.numberOfItems).toBe(count);
    expect(schema).not.toHaveProperty("offers");
    expect($('link[rel="canonical"]').attr("href")).toBe(
      `https://www.pixelshroomstudio.com/${slug}.html`,
    );
  }
});
it("locks retired physical tables without deleting historical records or requiring those tables", async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon;create role authenticated;create role service_role;");
    const sql = fs.readFileSync(
      "supabase/migrations/202610100001_retire_physical_checkout.sql",
      "utf8",
    );
    await db.exec(sql);
    await db.exec(
      "create table physical_orders(id int);insert into physical_orders values(1);create table physical_products(id int);grant all on physical_orders,physical_products to anon,authenticated,service_role;",
    );
    await db.exec(sql);
    expect((await db.query("select count(*)::int as n from physical_orders")).rows[0].n).toBe(1);
    await db.exec("set role service_role");
    await expect(db.query("select * from physical_orders")).rejects.toThrow();
    await expect(db.query("select * from physical_products")).rejects.toThrow();
  } finally {
    await db.close();
  }
});
