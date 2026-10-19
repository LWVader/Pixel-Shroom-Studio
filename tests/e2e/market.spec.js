import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const mint = "11111111-1111-4111-8111-111111111111",
  offer = "22222222-2222-4222-8222-222222222222",
  lease = "33333333-3333-4333-8333-333333333333";
async function fixtures(page) {
  await page.route("https://esm.sh/@supabase/supabase-js@2.57.4", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `export function createClient(){return {auth:{getSession:async()=>({data:{session:{access_token:'member-fixture'}}}),onAuthStateChange:()=>{},signOut:async()=>{}}}}`,
    }),
  );
  await page.route("**/functions/v1/mint-access", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: mint,
            title: "Gold fixture",
            state: "ready",
            tier: "Gold",
            mintNumber: 42,
            maxSupply: 500,
            width: 512,
            height: 512,
            canList: true,
            imageUrl:
              "https://decizwtgsqhjdgjiqbui.supabase.co/storage/v1/object/sign/minted/owner/mint/lease.webp?token=fixture",
            manifest: {},
          },
        ],
        hasMore: false,
      },
    }),
  );
  await page.route("**/storage/v1/object/**", (route) =>
    route.fulfill({ path: "public/assets/art-fantasy.png" }),
  );
  await page.route("**/functions/v1/market-api", (route) => {
    const body = route.request().postDataJSON();
    if (body.action === "feed")
      return route.fulfill({
        json: {
          enabled: true,
          items:
            body.tier === "Prismatic"
              ? []
              : [
                  {
                    id: offer,
                    tier: "Gold",
                    title: "Gold fixture",
                    serial: "LWV-0000000001",
                    mint_number: 42,
                    max_supply: 500,
                    price_cents: 5000,
                    preview_path: `secondary/${offer}/${lease}.webp`,
                  },
                ],
          hasMore: false,
        },
      });
    if (body.action === "seller_status")
      return route.fulfill({ json: { ready: true, enabled: true } });
    if (body.action === "list")
      return route.fulfill({ json: { listingId: offer, status: "preparing" }, status: 201 });
    if (body.action === "purchase")
      return route.fulfill({ json: { purchase: { state: "succeeded" } } });
    if (body.action === "checkout")
      return route.fulfill({
        json: { checkoutUrl: "https://checkout.stripe.com/c/pay/fixture" },
        status: 201,
      });
    return route.fulfill({ json: { items: [] } });
  });
}
test("market filters protected variants and uses Stripe checkout", async ({ page, request }) => {
  await fixtures(page);
  await page.route("https://checkout.stripe.com/**", (route) =>
    route.fulfill({ body: "Stripe fixture" }),
  );
  await page.goto("/market.html");
  await expect(page.locator("#market-feed .foil-card")).toHaveCount(1);
  await expect(page.locator("#market-feed")).toContainText("$50.00");
  await page.locator("[name=tier]").selectOption("Prismatic");
  await page.getByRole("button", { name: "Filter listings" }).click();
  await expect(page.locator("#market-feed .foil-card")).toHaveCount(0);
  await page.locator("[name=tier]").selectOption("Gold");
  await page.getByRole("button", { name: "Filter listings" }).click();
  await expect(page.locator("#market-feed .foil-card")).toHaveCount(1);
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.MARKET_VISUAL_QA)
    await page.screenshot({
      path: `/tmp/pixel-market-${test.info().project.name}.png`,
      fullPage: true,
    });
  expect((await request.get("/market", { maxRedirects: 0 })).status()).toBe(301);
  await page.locator("[data-market-buy]").click();
  await expect(page).toHaveURL("https://checkout.stripe.com/c/pay/fixture");
});
test("seller receives the gross fee quote and only submits own selected mint", async ({ page }) => {
  await fixtures(page);
  await page.goto("/collection.html");
  await expect(page.locator("[data-sell]")).toHaveCount(1);
  await page.locator("[data-sell]").click();
  await expect(page.locator("#sell-dialog")).toBeVisible();
  await expect(page.locator("#sell-summary")).toContainText("−$5.00");
  await expect(page.locator("#sell-summary")).toContainText("$45.00");
  await page.locator("#sell-form input[type=checkbox]").check();
  const requestPromise = page.waitForRequest(
    (req) => req.url().endsWith("/market-api") && req.postDataJSON()?.action === "list",
  );
  await page.locator("#sell-form [type=submit]").click();
  const req = await requestPromise;
  expect(req.postDataJSON()).toEqual({ action: "list", mintId: mint, priceCents: 5000 });
  await expect(page.locator("#sell-dialog")).not.toBeVisible();
  await expect(page.locator("#collection-status")).toContainText("protected variant preview");
});
test("sale confirmation waits for the ledger outcome rather than trusting URL parameters", async ({
  page,
}) => {
  await fixtures(page);
  await page.goto("/market.html?purchase=fixture");
  await expect(page.locator("#market-purchase")).toContainText("Payment verified");
  await page.route("**/functions/v1/market-api", (route) =>
    route.fulfill({ json: { enabled: true, items: [], purchase: { state: "refund_pending" } } }),
  );
  await page.goto("/market.html?purchase=fixture");
  await expect(page.locator("#market-purchase")).toContainText("refund is being processed");
});
