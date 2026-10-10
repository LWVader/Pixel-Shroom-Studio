import { it, expect, vi, afterEach } from "vitest";
import { readEbayListings, projectItems, renderEbayPage } from "../../ebay-feed.mjs";
import worker from "../../worker.mjs";
import fs from "node:fs";
const row = (id, title = "Art canvas") => ({
  legacyItemId: String(id),
  title,
  seller: { username: "lwvader" },
  image: { imageUrl: "https://i.ebayimg.com/images/test.jpg" },
});
afterEach(() => vi.useRealTimers());
it("projects only this seller, eligible categories, active dates and safe eBay previews", () => {
  const rows = [
    row(198704183258),
    row(198704183259, "Art T-shirt"),
    row(198704183260, "unrelated book"),
    { ...row(198704183261), seller: { username: "other" } },
    { ...row(198704183262), itemEndDate: "2020-01-01" },
    { ...row(198704183263), image: { imageUrl: "https://evil.example/a" } },
    row(198704183258),
  ];
  expect(projectItems(rows).map((x) => x.category)).toEqual(["canvas", "apparel"]);
});
it("paginates, coalesces concurrent requests and refreshes additions/removals after five minutes", async () => {
  vi.useFakeTimers();
  let generation = 0;
  const calls = [];
  const env = {
    EBAY_CLIENT_ID: "pagination",
    EBAY_CLIENT_SECRET: "test",
    EBAY_FETCH: async (url, options) => {
      calls.push({ url, options });
      if (url.includes("oauth2"))
        return Response.json({ access_token: "private-token", expires_in: 7200 });
      const offset = Number(new URL(url).searchParams.get("offset"));
      return Response.json(
        generation
          ? { total: 1, itemSummaries: [row(198704183299, "New tee")] }
          : {
              total: 201,
              itemSummaries:
                offset === 0
                  ? Array.from({ length: 200 }, (_, i) => row(198704180000 + i))
                  : [row(198704183258)],
            },
      );
    },
  };
  const [a, b] = await Promise.all([readEbayListings(env), readEbayListings(env)]);
  expect(a).toBe(b);
  expect(a.items).toHaveLength(201);
  expect(calls).toHaveLength(3);
  expect(new URL(calls[1].url).searchParams.get("filter")).toBe("sellers:{lwvader}");
  expect(calls[1].options.method).toBeUndefined();
  expect(JSON.stringify(a)).not.toContain("private-token");
  generation = 1;
  vi.advanceTimersByTime(300001);
  const changed = await readEbayListings(env);
  expect(changed.items.map((x) => x.itemId)).toEqual(["198704183299"]);
  expect(calls.filter((x) => x.url.includes("oauth2"))).toHaveLength(1);
});
it("does not publish partial pages, provider errors or stale cache on refresh failures", async () => {
  vi.useFakeTimers();
  let failing = false;
  const env = {
    EBAY_CLIENT_ID: "failure",
    EBAY_CLIENT_SECRET: "test",
    EBAY_FETCH: async (url) =>
      url.includes("oauth2")
        ? Response.json({ access_token: "token", expires_in: 7200 })
        : failing
          ? new Response("no", { status: 500 })
          : Response.json({ total: 1, itemSummaries: [row(198704183258)] }),
  };
  await readEbayListings(env);
  failing = true;
  vi.advanceTimersByTime(300001);
  await expect(readEbayListings(env)).rejects.toThrow();
  await expect(readEbayListings({})).rejects.toThrow("not configured");
});
it("refreshes expired authorization once and keeps secrets out of the public endpoint", async () => {
  let tokens = 0,
    searches = 0;
  const env = {
    EBAY_CLIENT_ID: "auth",
    EBAY_CLIENT_SECRET: "secret",
    EBAY_FETCH: async (url) =>
      url.includes("oauth2")
        ? Response.json({ access_token: `token${++tokens}`, expires_in: 7200 })
        : ++searches === 1
          ? new Response(null, { status: 401 })
          : Response.json({ total: 0 }),
  };
  const response = await worker.fetch(
    new Request("https://www.pixelshroomstudio.com/api/ebay-listings"),
    env,
  );
  expect(response.status).toBe(200);
  expect(tokens).toBe(2);
  expect(await response.text()).not.toContain("secret");
  expect(response.headers.get("cache-control")).toBe("no-store");
  const unavailable = await worker.fetch(
    new Request("https://www.pixelshroomstudio.com/api/ebay-listings"),
    {},
  );
  expect(unavailable.status).toBe(503);
  const denied = await worker.fetch(
    new Request("https://www.pixelshroomstudio.com/api/ebay-listings", { method: "POST" }),
    env,
  );
  expect(denied.status).toBe(405);
});
it("renders current listings and matching crawlable schema; fallback removes expired metadata", async () => {
  const html = fs.readFileSync("public/canvases.html", "utf8");
  const catalog = {
    seller: "lwvader",
    storeUrl: "https://www.ebay.com/sch/i.html?_ssn=lwvader",
    items: projectItems([row(198704183258, "Canvas <script>bad</script>")]),
  };
  const rendered = renderEbayPage(html, "canvas", catalog);
  expect(rendered).toContain('class="ebay-product"');
  expect(rendered).toContain('"numberOfItems":1');
  expect(rendered).not.toContain("<script>bad");
  const fallback = renderEbayPage(html, "canvas", null);
  expect(fallback).not.toContain('class="ebay-product"');
  expect(fallback).toContain('"numberOfItems":0');
  const env = {
    ASSETS: {
      fetch: async () =>
        new Response(html, { headers: { "content-type": "text/html", etag: '"stale"' } }),
    },
  };
  const response = await worker.fetch(
    new Request("https://www.pixelshroomstudio.com/canvases.html"),
    env,
  );
  expect(response.headers.get("etag")).toBeNull();
  expect(await response.text()).toContain("temporarily unavailable");
});
