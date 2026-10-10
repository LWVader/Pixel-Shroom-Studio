import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
const items = JSON.parse(fs.readFileSync("public/ebay-listings.json", "utf8")).items.filter(
  (item) => item.active === true,
);
for (const [slug, count] of [
  ["canvases", items.filter((item) => item.category === "canvas").length],
  ["apparel", items.filter((item) => item.category === "apparel").length],
])
  test(`${slug} uses only eBay links with no order or image uploads`, async ({ page }) => {
    const errors = [],
      requests = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => requests.push({ url: r.url(), method: r.method() }));
    await page.route("https://i.ebayimg.com/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"><rect width="500" height="500" fill="#132b20"/></svg>',
      }),
    );
    await page.goto(`/${slug}.html`);
    await expect(page.locator(".ebay-product")).toHaveCount(count);
    await expect(page.locator("form,[download],button")).toHaveCount(0);
    expect(requests.some((r) => r.method !== "GET")).toBe(false);
    expect(
      requests.some((r) => r.url.includes("supabase.co") || r.url.includes("/functions/v1/")),
    ).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(axe.violations).toEqual([]);
  });
test("canvas clicks go directly to the configured eBay listing", async ({ page }) => {
  const canvas = items.find((item) => item.category === "canvas");
  test.skip(!canvas, "No active canvas listing is configured.");
  const destination = `https://www.ebay.com/itm/${canvas.itemId}`;
  await page.route(destination, (route) =>
    route.fulfill({ contentType: "text/html", body: "<h1>eBay listing destination fixture</h1>" }),
  );
  await page.goto("/canvases.html");
  await page.getByRole("link", { name: "View and buy on eBay" }).first().click();
  await expect(page).toHaveURL(destination);
});
test("homepage navigation opens the two storefronts", async ({ page }) => {
  await page.goto("/");
  const mobile = page.viewportSize().width < 701;
  const menu = page.locator(mobile ? ".mobile" : ".primary");
  if (mobile) await menu.locator("summary").click();
  await menu.getByRole("link", { name: "Canvases", exact: true }).click();
  await expect(page).toHaveURL(/canvases\.html$/);
  const next = page.locator(mobile ? ".mobile" : ".primary");
  if (mobile) await next.locator("summary").click();
  await next.getByRole("link", { name: "Apparel & gifts", exact: true }).click();
  await expect(page).toHaveURL(/apparel\.html$/);
});
test("retired physical-order routes redirect and ordering API paths are unavailable", async ({
  request,
}) => {
  for (const path of ["/physical-order.html", "/physical-order"]) {
    const r = await request.get(path, { maxRedirects: 0 });
    expect(r.status()).toBe(301);
    expect(new URL(r.headers().location).pathname).toBe("/canvases.html");
  }
  for (const path of [
    "/physical-store.js",
    "/physical-order.js",
    "/functions/v1/physical-checkout",
  ])
    expect((await request.get(path)).status()).toBe(404);
});
