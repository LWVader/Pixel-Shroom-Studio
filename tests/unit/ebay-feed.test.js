import { it, expect, vi, afterEach } from "vitest";
import {
  readEbayListings,
  projectItems,
  renderEbayPage,
  parseTradingResponse,
} from "../../ebay-feed.mjs";
import { xmlResponse, sellerPage, sellerItem } from "../ebay-fixture.mjs";
import worker from "../../worker.mjs";
import fs from "node:fs";
afterEach(() => vi.useRealTimers());
function environment(fetcher, id = "fixture") {
  return {
    EBAY_CLIENT_ID: id,
    EBAY_CLIENT_SECRET: "secret",
    EBAY_REFRESH_TOKEN: "private-refresh-token",
    EBAY_FETCH: fetcher,
  };
}
function publicFixture(url, options, items = []) {
  if (url.includes("oauth2"))
    return Response.json({ access_token: "private-access-token", expires_in: 7200 });
  if (options.headers["X-EBAY-API-CALL-NAME"] === "GetUser")
    return xmlResponse("GetUser", { User: { UserID: "lwvader" } });
  return sellerPage(items);
}
it("projects active previews, includes apparel without title keywords and blocks unsafe images", () => {
  const rows = [
    sellerItem(198704183258),
    sellerItem(198704183259, "MAKE IT IDIOT-PROOF"),
    sellerItem(198704183260, "Ended canvas", { ListingDetails: { EndTime: "2020-01-01" } }),
    sellerItem(198704183261, "Sold shirt", { QuantityAvailable: "0" }),
    sellerItem(198704183262, "Unsafe tee", {
      PictureDetails: { GalleryURL: "https://evil.example/a" },
    }),
    sellerItem(198704183258),
  ];
  expect(projectItems(rows).map((x) => x.category)).toEqual(["canvas", "apparel"]);
  expect(
    projectItems([
      sellerItem(198704183263, "Legacy tee", {
        PictureDetails: { GalleryURL: "http://i.ebayimg.com/test.jpg" },
      }),
    ])[0].imageUrl,
  ).toBe("https://i.ebayimg.com/test.jpg");
});
it("paginates complete seller inventory, coalesces requests and refreshes additions/removals", async () => {
  vi.useFakeTimers();
  let generation = 0;
  const calls = [];
  const env = environment(async (url, options) => {
    calls.push({ url, options });
    if (url.includes("oauth2") || options.headers["X-EBAY-API-CALL-NAME"] === "GetUser")
      return publicFixture(url, options);
    const page = Number(options.body.match(/<PageNumber>(\d+)<\/PageNumber>/)[1]);
    return generation
      ? sellerPage([sellerItem(198704183299, "New design")])
      : sellerPage(
          page === 1
            ? Array.from({ length: 200 }, (_, i) => sellerItem(198704180000 + i))
            : [sellerItem(198704183258)],
          page,
          201,
        );
  });
  const [a, b] = await Promise.all([readEbayListings(env), readEbayListings(env)]);
  expect(a).toBe(b);
  expect(a.items).toHaveLength(201);
  expect(calls).toHaveLength(4);
  const auth = new URLSearchParams(calls[0].options.body);
  expect(auth.get("grant_type")).toBe("refresh_token");
  expect(auth.get("refresh_token")).toBe("private-refresh-token");
  expect(auth.get("scope")).toBe("https://api.ebay.com/oauth/api_scope");
  expect(
    calls.every((x) => x.url.includes("oauth2") || x.url === "https://api.ebay.com/ws/api.dll"),
  ).toBe(true);
  for (const call of calls.filter(
    (x) => x.options.headers["X-EBAY-API-CALL-NAME"] === "GetMyeBaySelling",
  )) {
    expect(call.options.body).toContain("<SoldList><Include>false</Include></SoldList>");
    expect(call.options.body).not.toContain("<ItemID>");
  }
  expect(JSON.stringify(a)).not.toContain("private-");
  expect(a.source).toBe("seller-active-listings");
  generation = 1;
  vi.advanceTimersByTime(300001);
  const changed = await readEbayListings(env);
  expect(changed.items.map((x) => x.itemId)).toEqual(["198704183299"]);
  expect(calls.filter((x) => x.url.includes("oauth2"))).toHaveLength(1);
});
it("rejects a refresh token belonging to another seller", async () => {
  let inventoryCalls = 0;
  const env = environment(async (url, options) => {
    if (url.includes("oauth2")) return publicFixture(url, options);
    if (options.headers["X-EBAY-API-CALL-NAME"] === "GetUser")
      return xmlResponse("GetUser", { User: { UserID: "other" } });
    inventoryCalls++;
    return sellerPage([]);
  });
  await expect(readEbayListings(env)).rejects.toThrow("lwvader");
  expect(inventoryCalls).toBe(0);
});
it("never publishes partial, truncated or inconsistent inventory", async () => {
  for (const mode of ["failure", "changed", "duplicate", "limit"]) {
    const env = environment(async (url, options) => {
      if (url.includes("oauth2") || options.headers["X-EBAY-API-CALL-NAME"] === "GetUser")
        return publicFixture(url, options);
      if (mode === "limit") return sellerPage([], 1, 25000);
      const page = Number(options.body.match(/<PageNumber>(\d+)<\/PageNumber>/)[1]);
      if (page === 1)
        return sellerPage(
          Array.from({ length: 200 }, (_, i) => sellerItem(198704180000 + i)),
          1,
          201,
        );
      if (mode === "failure") return new Response(null, { status: 500 });
      return sellerPage(
        [sellerItem(mode === "duplicate" ? 198704180000 : 198704183299)],
        2,
        mode === "changed" ? 202 : 201,
      );
    }, mode);
    await expect(readEbayListings(env)).rejects.toThrow();
  }
});
it("does not reuse expired catalog after failure and retries authorization once", async () => {
  vi.useFakeTimers();
  let fail = false;
  const env = environment(
    (url, options) =>
      fail
        ? new Response(null, { status: 500 })
        : publicFixture(url, options, [sellerItem(198704183258)]),
    "failure-after-refresh",
  );
  await readEbayListings(env);
  fail = true;
  vi.advanceTimersByTime(300001);
  await expect(readEbayListings(env)).rejects.toThrow();
  let tokens = 0,
    identities = 0;
  const retry = environment(async (url, options) => {
    if (url.includes("oauth2")) {
      tokens++;
      return Response.json({ access_token: `token${tokens}`, expires_in: 7200 });
    }
    if (options.headers["X-EBAY-API-CALL-NAME"] === "GetUser") {
      identities++;
      if (identities === 1) return new Response(null, { status: 401 });
      return xmlResponse("GetUser", { User: { UserID: "lwvader" } });
    }
    return sellerPage([]);
  }, "retry");
  expect((await readEbayListings(retry)).items).toEqual([]);
  expect(tokens).toBe(2);
});
it("rejects invalid XML, API errors and entity declarations", () => {
  for (const xml of [
    "<GetMyeBaySellingResponse>",
    "<!DOCTYPE x><GetMyeBaySellingResponse><Ack>Success</Ack></GetMyeBaySellingResponse>",
    "<GetMyeBaySellingResponse><Ack>Failure</Ack><Errors><ErrorCode>219</ErrorCode></Errors></GetMyeBaySellingResponse>",
  ])
    expect(() => parseTradingResponse(xml, "GetMyeBaySelling")).toThrow();
});
it("keeps credentials and account details out of the public endpoint", async () => {
  const env = environment(
    (url, options) => publicFixture(url, options, [sellerItem(198704183258)]),
    "endpoint",
  );
  const response = await worker.fetch(
    new Request("https://www.pixelshroomstudio.com/api/ebay-listings"),
    env,
  );
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.items).toHaveLength(1);
  expect(JSON.stringify(data)).not.toMatch(/secret|private-|Buyer|UserID/);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(
    (await worker.fetch(new Request("https://www.pixelshroomstudio.com/api/ebay-listings"), {}))
      .status,
  ).toBe(503);
  expect(
    (
      await worker.fetch(
        new Request("https://www.pixelshroomstudio.com/api/ebay-listings", { method: "POST" }),
        env,
      )
    ).status,
  ).toBe(405);
  await expect(
    readEbayListings({ EBAY_CLIENT_ID: "id", EBAY_CLIENT_SECRET: "secret" }),
  ).rejects.toThrow("not configured");
});
it("renders current cards and matching schema, removes stale metadata on fallback", async () => {
  const html = fs.readFileSync("public/canvases.html", "utf8");
  const catalog = {
    seller: "lwvader",
    storeUrl: "https://www.ebay.com/sch/i.html?_ssn=lwvader",
    items: projectItems([sellerItem(198704183258, "Canvas <script>bad</script>")]),
  };
  const rendered = renderEbayPage(html, "canvas", catalog);
  expect(rendered).toContain('class="ebay-product"');
  expect(rendered).toContain('"numberOfItems":1');
  expect(rendered).not.toContain("<script>bad");
  const fallback = renderEbayPage(html, "canvas", null);
  expect(fallback).not.toContain('class="ebay-product"');
  expect(fallback).toContain('"numberOfItems":0');
  const response = await worker.fetch(
    new Request("https://www.pixelshroomstudio.com/canvases.html"),
    {
      ASSETS: {
        fetch: async () =>
          new Response(html, { headers: { "content-type": "text/html", etag: '"stale"' } }),
      },
    },
  );
  expect(response.headers.get("etag")).toBeNull();
  expect(await response.text()).toContain("temporarily unavailable");
});

it("renews HTTP-200 expired-token responses and rechecks the seller before publishing", async () => {
  for (const changedSeller of [false, true]) {
    let tokens = 0,
      inventory = 0;
    const env = environment(async (url, options) => {
      if (url.includes("oauth2")) {
        tokens++;
        return Response.json({ access_token: `access${tokens}`, expires_in: 7200 });
      }
      if (options.headers["X-EBAY-API-CALL-NAME"] === "GetUser")
        return xmlResponse("GetUser", {
          User: { UserID: changedSeller && tokens > 1 ? "other" : "lwvader" },
        });
      if (++inventory === 1)
        return xmlResponse("GetMyeBaySelling", {
          Ack: "Failure",
          Errors: { ErrorCode: "932", SeverityCode: "Error" },
        });
      return sellerPage([sellerItem(198704183299, "New apparel")]);
    }, `xml-expiry-${changedSeller}`);
    if (changedSeller) await expect(readEbayListings(env)).rejects.toThrow("lwvader");
    else expect((await readEbayListings(env)).items).toHaveLength(1);
    expect(tokens).toBe(2);
  }
});
it("accepts a successful empty active collection without retaining previous listings", async () => {
  const env = environment(
    (url, options) =>
      url.includes("oauth2") || options.headers["X-EBAY-API-CALL-NAME"] === "GetUser"
        ? publicFixture(url, options)
        : xmlResponse("GetMyeBaySelling"),
    "empty",
  );
  expect((await readEbayListings(env)).items).toEqual([]);
});

it("uses Auth'n'Auth without OAuth requests and escapes the private token", async () => {
  const calls = [];
  const env = {
    EBAY_AUTH_TOKEN: "legacy<&private",
    EBAY_FETCH: async (url, options) => {
      calls.push({ url, options });
      expect(url).toBe("https://api.ebay.com/ws/api.dll");
      expect(options.headers).not.toHaveProperty("X-EBAY-API-IAF-TOKEN");
      expect(options.body).toContain("<eBayAuthToken>legacy&lt;&amp;private</eBayAuthToken>");
      return options.headers["X-EBAY-API-CALL-NAME"] === "GetUser"
        ? xmlResponse("GetUser", { User: { UserID: "lwvader" } })
        : sellerPage([sellerItem(198704183258)]);
    },
  };
  const data = await readEbayListings(env);
  expect(data.items).toHaveLength(1);
  expect(data.authentication).toBe("auth-n-auth");
  expect(JSON.stringify(data)).not.toContain("legacy");
  expect(calls).toHaveLength(2);
});
