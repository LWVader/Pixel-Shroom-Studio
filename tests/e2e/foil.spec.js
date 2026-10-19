import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const edition = {
  artworkId: 1,
  enabled: true,
  maxSupply: 500,
  totalMinted: 42,
  reserved: 2,
  prismaticsRemaining: 3,
  silverCap: 100,
  goldCap: 45,
  prismaticCap: 5,
  price: 15,
};
const imageUrl =
  "https://decizwtgsqhjdgjiqbui.supabase.co/storage/v1/object/sign/minted/owner/mint/lease.webp?token=fixture";
const item = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Foil fixture",
  state: "ready",
  mintNumber: 42,
  maxSupply: 500,
  tier: "Prismatic",
  width: 512,
  height: 512,
  imageUrl,
  manifest: { payload: { mintId: "fixture" }, signature: "fixture" },
};
async function routes(page, items = [item]) {
  await page.route("https://esm.sh/@supabase/supabase-js@2.57.4", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `export function createClient(){return {auth:{getSession:async()=>({data:{session:{access_token:'owner-fixture'}}}),onAuthStateChange:()=>{},signOut:async()=>{},signInWithPassword:async()=>({data:{session:{}}})},rpc:async()=>({data:${JSON.stringify([edition])}})}}`,
    }),
  );
  await page.route("**/rest/v1/rpc/foil_catalog", (route) => route.fulfill({ json: [edition] }));
  await page.route("**/functions/v1/mint-access", (route) =>
    route.fulfill({ json: { items, hasMore: false } }),
  );
  await page.route("**/storage/v1/object/sign/minted/**", (route) =>
    route.fulfill({ path: "public/assets/art-fantasy.png" }),
  );
}
test("foil mode replaces master checkout and discloses changing odds", async ({ page }) => {
  await routes(page);
  await page.goto("/genre.html?genre=portrait");
  const card = page.locator('[data-artwork-id="1"]');
  await expect(card.getByText("42/500 allocated", { exact: false })).toBeVisible();
  await expect(card.locator("[data-buy]")).toHaveCount(0);
  await card.getByText("Foil edition: odds and delivery").click();
  await expect(card).toContainText("Prismatic 1%");
  await expect(card).toContainText("master file is not included");
  await card.getByRole("link", { name: "Mint with Stripe" }).click();
  await expect(page).toHaveURL(/collection.html\?mint=1/);
  await expect(page.locator("#start-mint")).toBeEnabled();
  await expect(page.locator("#mint-panel")).toContainText("No blockchain token");
});
test("collection shows only private variants and confirmation reveals the mint", async ({
  page,
}) => {
  await routes(page);
  await page.goto("/collection.html");
  await expect(page.locator(".foil-card")).toHaveCount(1);
  await expect(page.locator(".foil-card")).toContainText("Prismatic · #42 of 500");
  await expect(page.getByRole("button", { name: "Download variant", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
  if (process.env.FOIL_VISUAL_QA)
    await page.screenshot({
      path: `/tmp/pixel-foil-${test.info().project.name}.png`,
      fullPage: true,
    });
  await page.route("**/functions/v1/order-status", (route) =>
    route.fulfill({
      json: { status: "paid", kind: "foil", mint: { id: item.id, state: "ready" } },
    }),
  );
  await page.goto("/checkout-success.html?order=fixture&access=fixture");
  await expect(page.locator("h1")).toHaveText("Prismatic edition revealed");
  await expect(page.locator("#download-link")).toBeHidden();
  await expect(page.getByRole("button", { name: "Download minted variant" })).toBeVisible();
});
test("pending or failed rendering never exposes the original download", async ({ page }) => {
  await routes(page, []);
  await page.route("**/functions/v1/order-status", (route) =>
    route.fulfill({
      json: { status: "paid", kind: "foil", mint: { id: item.id, state: "failed" } },
    }),
  );
  await page.goto("/checkout-success.html?order=fixture&access=fixture");
  await expect(page.locator("#checkout-message")).toContainText("Rendering needs studio attention");
  await expect(page.locator("#download-link")).toBeHidden();
  await expect(page.locator("img")).toHaveCount(0);
});

test("Buy opens effects immediately while server checkout runs, without submitting a tier", async ({
  page,
}) => {
  await routes(page);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let checkoutBody;
  await page.route("**/functions/v1/mint-checkout", async (route) => {
    checkoutBody = route.request().postDataJSON();
    await gate;
    await route.fulfill({
      json: { checkoutUrl: "https://checkout.stripe.com/foil-opening-fixture" },
    });
  });
  await page.route("https://checkout.stripe.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<h1>Fixture checkout</h1>" }),
  );
  await page.goto("/collection.html?mint=1");
  await page.locator("#start-mint").click();
  await expect(page.locator(".foil-opening-dialog[open]")).toBeVisible();
  await expect(page.locator(".foil-opening-dialog")).toContainText("after payment is confirmed");
  await expect.poll(() => checkoutBody).toEqual({ artworkId: "1" });
  await expect(page.locator(".foil-opening-dialog img")).toBeHidden();
  release();
  await expect(page).toHaveURL("https://checkout.stripe.com/foil-opening-fixture");
});

test("failed checkout removes the opening and allows retry without allocating a result", async ({
  page,
}) => {
  await routes(page);
  await page.route("**/functions/v1/mint-checkout", (route) =>
    route.fulfill({ status: 409, json: { error: "Sold out fixture" } }),
  );
  await page.goto("/collection.html?mint=1");
  await page.locator("#start-mint").click();
  await expect(page.locator("#collection-status")).toContainText("Sold out fixture");
  await expect(page.locator(".foil-opening-dialog")).toHaveCount(0);
  await expect(page.locator("#start-mint")).toBeEnabled();
});
