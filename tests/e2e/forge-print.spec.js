import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const rows = Array.from({ length: 6 }, (_, i) => ({
  id: i + 1,
  title: `Portrait artwork ${i + 1}`,
  artist: "LWVader",
  category: "Portrait",
  serial_number: `LWV-${String(i + 1).padStart(10, "0")}`,
  price: 15,
  preview_url: "http://127.0.0.1:8020/assets/art-portrait.png",
  display_width: 512,
  display_height: 512,
}));
test.beforeEach(async ({ page }) => {
  await page.route("**/*.supabase.co/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/artworks")) return route.fulfill({ json: rows });
    if (path.endsWith("/foil_catalog")) return route.fulfill({ json: [] });
    if (path.endsWith("/articles") || path.endsWith("/artwork_signatures"))
      return route.fulfill({ json: [] });
    return route.abort();
  });
});
test("global search finds the full catalog and art details save planned choices without charging", async ({
  page,
}) => {
  const checkouts = [];
  page.on("request", (r) => {
    if (/(create-checkout|mint-checkout|checkout.stripe.com)/.test(r.url()))
      checkouts.push(r.url());
  });
  await page.goto("/");
  expect(
    await page.locator(".hero").evaluate((hero) => {
      const last = hero.querySelector(".offer-state");
      return last.getBoundingClientRect().bottom <= hero.getBoundingClientRect().bottom + 1;
    }),
  ).toBe(true);
  if (process.env.LAYOUT_QA_SHOTS)
    await page.screenshot({ path: `/tmp/pixel-shroom-home-${test.info().project.name}.png` });
  await page.locator(".header-search summary").click();
  await page.locator("#header-art-search").fill("LWV-0000000001");
  await page.locator(".site-search button").click();
  await expect(page.locator(".art-card")).toHaveCount(1);
  await page.locator(".art-card h3 a").click();
  await expect(page).toHaveURL(/art.html\?id=1$/);
  await expect(page.locator("h1")).toHaveText("Portrait artwork 1");
  if (process.env.LAYOUT_QA_SHOTS)
    await page.screenshot({ path: `/tmp/pixel-shroom-art-${test.info().project.name}.png` });
  await page.locator(".detail-preview-trigger").click();
  await expect(page.locator("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog")).not.toBeVisible();
  await page.locator("[name=offer][value=canvas]").check();
  await expect(page.locator("#offer-summary")).toContainText("$82.49");
  await page.getByRole("button", { name: "Save planned selection to cart" }).click();
  await expect(page.locator("#selection-status")).toContainText("No payment");
  await page.locator("#selection-status a").click();
  await expect(page.locator(".cart-row")).toHaveCount(1);
  await page.evaluate(() =>
    localStorage.setItem(
      "pixel-shroom-selections-v1",
      JSON.stringify([
        { artworkId: "1", offer: "canvas" },
        { artworkId: "2", offer: "digital" },
      ]),
    ),
  );
  await page.reload();
  await expect(page.locator(".cart-row")).toHaveCount(2);
  await expect(page.locator("#cart-status")).toContainText("checkout is not open");
  await page.getByRole("button", { name: "Remove", exact: true }).first().click();
  await expect(page.locator(".cart-row")).toHaveCount(1);
  await expect(page.locator(".cart-row h2")).toHaveText("Portrait artwork 2");
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.locator("#planned-cart")).toContainText("empty");
  expect(checkouts).toEqual([]);
});
test("tier comparisons and Forge recipe calculator remain transparent and accessible", async ({
  page,
}) => {
  await page.goto("/drop-odds.html");
  await page.locator("[data-tier-finish=Emerald]").click();
  await expect(page.locator("#finish-title")).toHaveText("Emerald · 6%");
  await expect(page.locator("#finish-format")).toContainText("16 × 20");
  await page.goto("/forge.html");
  await page.locator("[name=tier]").selectOption("Gold");
  await page.locator("[name=quantity]").fill("2");
  await page.getByRole("button", { name: "Preview upgrade quantities" }).click();
  await expect(page.locator("#forge-estimate")).toContainText("0 Emerald");
  await expect(page.locator("#forge-estimate")).toContainText("Nothing was consumed");
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(axe.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("detail routes preserve canonical IDs, private cart headers and genuine missing-art responses", async ({
  request,
}) => {
  const response = await request.get("/art.html?id=1");
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain("art.html?id=1");
  for (const path of ["/art.html?id=999999", "/art.html?id=bad", "/art.html?id=1&id=2"])
    expect((await request.get(path)).status()).toBe(404);
  const cart = await request.get("/cart.html");
  expect(cart.headers()["x-robots-tag"]).toContain("noindex");
  expect(cart.headers()["cache-control"]).toBe("no-store");
  const vault = await request.get("/vault", { maxRedirects: 0 });
  expect(vault.status()).toBe(301);
  expect(vault.headers().location).toContain("/collection.html");
});
