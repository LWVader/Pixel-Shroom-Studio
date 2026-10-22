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
  await page.route("**/functions/v1/mint-access", (route) => {
    const body = route.request().postDataJSON();
    return route.fulfill({
      json:
        body.action === "add_to_collection"
          ? { added: true }
          : { items: body.action === "uncollected" ? [] : items, hasMore: false },
    });
  });
  await page.route("**/storage/v1/object/sign/minted/**", (route) =>
    route.fulfill({
      path: "public/assets/art-fantasy.png",
      contentType: "image/png",
      headers: { "Access-Control-Allow-Origin": "*" },
    }),
  );
}
test("foil mode replaces master checkout and discloses changing odds", async ({ page }) => {
  await routes(page);
  await page.goto("/genre.html?genre=portrait");
  const card = page.locator('[data-artwork-id="1"]');
  await card.locator(".legacy-card-purchase > summary").click();
  await expect(card.getByText("42/500 allocated", { exact: false })).toBeVisible();
  await expect(card.locator("[data-buy]")).toHaveCount(0);
  await card.getByText("Edition details: tiers, odds and delivery").click();
  await expect(card).toContainText("Prismatic 1%");
  await expect(card).toContainText("master file is not included");
  await card.getByRole("link", { name: "Collect with Stripe" }).click();
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
  await expect(page.locator("h1")).toHaveText("Prismatic edition revealed", { timeout: 15000 });
  await expect(page.locator("#download-link")).toBeHidden();
  await expect(page.getByRole("button", { name: "Download minted variant" })).toHaveCount(0);
  await page.getByRole("button", { name: "Download edition & signed receipt" }).click();
  await expect(page.getByRole("button", { name: "Download my edition files again" })).toBeEnabled();
});
test("pending or failed rendering never exposes the original download", async ({ page }) => {
  await routes(page, []);
  await page.route("**/functions/v1/order-status", (route) =>
    route.fulfill({
      json: { status: "paid", kind: "foil", mint: { id: item.id, state: "failed" } },
    }),
  );
  await page.goto("/checkout-success.html?order=fixture&access=fixture");
  await expect(page.locator("#checkout-message")).toContainText(
    "Image delivery needs studio attention",
  );
  await expect(page.locator("#download-link")).toBeHidden();
  await expect(page.locator("img")).toHaveCount(0);
});

test("Buy redirects to payment without opening effects or submitting a tier", async ({ page }) => {
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
  await expect(page.locator(".foil-opening-dialog")).toHaveCount(0);
  await expect.poll(() => checkoutBody).toEqual({ artworkId: "1" });

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

test("only verified payment starts a concealed reveal; saving waits for completion", async ({
  page,
}) => {
  await routes(page);
  await page.addInitScript(() => {
    window.openingScenes = new Set();
    new MutationObserver(() => {
      document
        .querySelectorAll('.foil-scene[data-animation="running"]')
        .forEach((scene) => window.openingScenes.add(scene));
    }).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-animation"],
    });
  });
  let paid = false,
    ready = false;
  await page.route("**/functions/v1/order-status", (route) =>
    route.fulfill({
      json: {
        status: paid ? "paid" : "pending",
        kind: "foil",
        mint: { id: item.id, state: ready ? "ready" : "queued" },
      },
    }),
  );
  await page.goto("/checkout-success.html?order=fixture&access=fixture");
  await expect(page.locator(".foil-scene")).toHaveCount(0);
  paid = true;
  await expect(page.locator(".foil-scene")).toHaveCount(1);
  await expect(page.locator('.foil-scene[data-animation="running"]')).toHaveCount(1);
  const firstAngle = await page.locator(".foil-rotor").getAttribute("style");
  await expect(page.locator(".foil-scene img")).toBeHidden();
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => window.openingScenes.size)).toBe(1);
  expect(await page.locator(".foil-rotor").getAttribute("style")).not.toBe(firstAngle);
  await expect(page.getByRole("button", { name: "Download edition & signed receipt" })).toHaveCount(
    0,
  );
  const waitingStage = await page.locator(".foil-mystery-stage[open]").elementHandle();
  await page.evaluate(() => {
    window.stageClosedDuringHandoff = false;
    const stage = document.querySelector(".foil-mystery-stage[open]");
    new MutationObserver(() => {
      if (!stage.open && document.querySelector('.foil-scene[data-animation="running"]'))
        window.stageClosedDuringHandoff = true;
    }).observe(stage, { attributes: true, attributeFilter: ["open"] });
  });
  ready = true;
  await expect(page.locator('.foil-scene[data-animation="running"]')).toHaveCount(1);
  expect(await waitingStage.evaluate((stage) => stage.isConnected && stage.open)).toBe(true);
  expect(await page.locator(".foil-mystery-stage").count()).toBe(1);
  expect(await page.evaluate(() => window.stageClosedDuringHandoff)).toBe(false);
  await expect(page.locator("h1")).toHaveText("Prismatic edition revealed", { timeout: 15000 });
  await expect(
    page.getByRole("button", { name: "Download edition & signed receipt" }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.openingScenes.size)).toBe(1);
});

test("collection save survives a file failure and retries the same edition", async ({ page }) => {
  await routes(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  let adds = 0,
    deliveries = 0;
  await page.route("**/functions/v1/mint-access", (route) => {
    const action = route.request().postDataJSON().action;
    if (action === "add_to_collection") {
      adds++;
      return route.fulfill({ json: { added: true } });
    }
    if (action === "download" && ++deliveries === 1)
      return route.fulfill({ status: 503, json: { error: "Temporary delivery failure" } });
    return route.fulfill({ json: { items: [item] } });
  });
  await page.route("**/functions/v1/order-status", (route) =>
    route.fulfill({
      json: { status: "paid", kind: "foil", mint: { id: item.id, state: "ready" } },
    }),
  );
  await page.goto("/checkout-success.html?order=fixture&access=fixture");
  await page.getByRole("button", { name: "Download edition & signed receipt" }).click();
  await expect(page.locator("#checkout-message")).toContainText("saved in your collection");
  const downloads = [];
  page.on("download", (file) => downloads.push(file));
  await page.getByRole("button", { name: "Retry downloading my files" }).click();
  await expect(page.getByRole("button", { name: "Download my edition files again" })).toBeEnabled();
  await expect.poll(() => downloads.length).toBe(2);
  expect(adds).toBe(1);
  expect(deliveries).toBe(2);
  await expect(page).toHaveURL(/checkout-success.html/);
});
