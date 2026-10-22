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
test("search leads to two roll choices with a protected viewer and no premature payment", async ({
  page,
}) => {
  const charges = [];
  page.on("request", (r) => {
    if (/functions\/v1\/mint-checkout/.test(r.url())) charges.push(r.url());
  });
  await page.route("**/functions/v1/forge-api", (route) =>
    route.fulfill({
      json: {
        digitalEnabled: true,
        canvasEnabled: false,
        edition: {
          artworkId: 1,
          enabled: true,
          totalMinted: 0,
          maxSupply: 100,
          reserved: 0,
          prismaticsRemaining: 1,
          rulesVersion: 2,
        },
        previews: ["Standard", "Silver", "Gold", "Emerald", "Sapphire", "Prismatic"].map(
          (tier) => ({
            tier,
            width: 4800,
            height: 4800,
            mimeType: "image/png",
            previewUrl: "http://127.0.0.1:8020/assets/art-portrait.png",
          }),
        ),
      },
    }),
  );
  await page.route("https://esm.sh/@supabase/supabase-js@2.57.4", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: "export function createClient(){return {auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>{}},rpc:async()=>({data:[]})}}",
    }),
  );
  await page.goto("/");
  await page.locator(".header-search summary").click();
  await page.locator("#header-art-search").fill("LWV-0000000001");
  await page.locator(".site-search button").click();
  await expect(page.locator(".art-card")).toHaveCount(1);
  await page.locator(".art-card h3 a").click();
  await expect(page.locator("#roll-purchase")).toBeVisible();
  await expect(page.locator("#roll-purchase [name=offer]")).toHaveCount(2);
  await expect(page.locator(".tier-preview")).toHaveCount(6);
  await page.locator(".detail-preview-trigger").click();
  await expect(page.locator("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator("[name=offer][value=canvas]").check();
  await expect(page.locator("#roll-total")).toContainText("$82.49");
  await expect(page.locator("#roll-purchase button")).toBeDisabled();
  await page.locator("[name=offer][value=digital]").check();
  await expect(page.locator("#roll-purchase button")).toBeEnabled();
  await page.locator("#roll-purchase button").click();
  await expect(page).toHaveURL(/collection.html\?art=1&offer=digital/);
  expect(charges).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
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
test("Vault Forge retries keep one operation and prepaid printing never opens another payment", async ({
  page,
}) => {
  const ids = Array.from(
    { length: 5 },
    (_, i) => `11111111-1111-4111-8111-${String(i + 1).padStart(12, "0")}`,
  );
  const output = "22222222-2222-4222-8222-222222222222";
  await page.route("https://esm.sh/@supabase/supabase-js@2.57.4", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: "export function createClient(){return {auth:{getSession:async()=>({data:{session:{access_token:'fixture'}}}),onAuthStateChange:()=>{},signOut:async()=>{}},rpc:async()=>({data:[]})}}",
    }),
  );
  await page.route("**/functions/v1/mint-access", (r) =>
    r.fulfill({ json: { items: [], hasMore: false, count: 0 } }),
  );
  const requests = [];
  await page.route("**/functions/v1/forge-api", (r) => {
    const b = r.request().postDataJSON();
    if (b.action === "inventory")
      return r.fulfill({
        json: {
          forgeEnabled: true,
          items: ids.map((id) => ({
            id,
            artworkId: 1,
            title: "Fixture artwork",
            tier: "Standard",
            eligible: true,
          })),
        },
      });
    requests.push(b);
    return requests.length === 1
      ? r.fulfill({ status: 503, json: { error: "Temporary response failure" } })
      : r.fulfill({ json: { mintId: output, tier: "Silver" } });
  });
  await page.goto("/collection.html?tab=forge");
  await expect(page.locator(".forge-group")).toHaveCount(1);
  for (const checkbox of await page.locator(".forge-group [name=mint]").all())
    await checkbox.check();
  await page.locator(".forge-group [name=confirm]").check();
  await page.locator(".forge-group button").click();
  await expect(page.locator(".forge-result")).toContainText("retry");
  await page.locator(".forge-group button").click();
  await expect(page).toHaveURL(new RegExp("checkout-success.html\\?mint=" + output));
  expect(requests).toHaveLength(2);
  expect(requests[0].requestId).toBe(requests[1].requestId);
  expect(requests[0].mintIds).toEqual(requests[1].mintIds);
  expect(requests[0]).not.toHaveProperty("tier");
  const prints = [];
  await page.route("**/functions/v1/print-api", (r) => {
    const b = r.request().postDataJSON();
    prints.push(b);
    if (b.action === "catalog")
      return r.fulfill({
        json: {
          products: [
            {
              id: output,
              title: "Fixture artwork",
              kind: "canvas",
              variant_label: "16 × 16 slim",
              preview_url: "http://127.0.0.1:8020/assets/art-portrait.png",
              retail_cents: 0,
            },
          ],
          enabled: true,
          testMode: true,
          canvasClaim: "available",
        },
      });
    if (b.action === "quote")
      return r.fulfill({
        json: {
          quoteId: output,
          prepaid: true,
          productCents: 0,
          testMode: true,
          shipping: [{ uid: "standard", name: "Included US shipping", cents: 0 }],
        },
      });
    if (b.action === "checkout")
      return r.fulfill({
        json: { redeemed: true, orderUrl: "http://127.0.0.1:8020/collection.html?tab=orders" },
      });
    return r.fulfill({ json: { orders: [] } });
  });
  await page.goto("/canvases.html?mint=" + ids[0]);
  await page.locator("[data-print-product]").click();
  for (const [name, value] of Object.entries({
    firstName: "Test",
    lastName: "Buyer",
    addressLine1: "123 Test St",
    city: "Test City",
    state: "KY",
    postCode: "40202",
    phone: "5555555555",
  }))
    await page.locator(`[name=${name}]`).fill(value);
  await page.locator("[name=consent]").check();
  await page.locator("#print-quote-form [type=submit]").click();
  await expect(page.locator("#print-pay")).toHaveText(/Redeem included canvas/);
  await page.locator("#print-pay").click();
  await expect(page).toHaveURL(/collection.html\?tab=orders/);
  expect(prints.find((p) => p.action === "quote").mintId).toBe(ids[0]);
});
