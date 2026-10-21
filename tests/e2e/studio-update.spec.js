import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test.beforeEach(async ({ page }) => {
  await page.route("**/*.supabase.co/**", (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith("/articles")) return route.fulfill({ json: [] });
    if (p.endsWith("/submit-message"))
      return route.fulfill({ json: { sent: true, alertSent: false } });
    if (p.endsWith("/create-checkout"))
      return route.fulfill({
        json: { checkoutUrl: "https://checkout.stripe.com/c/pay/studio-fixture" },
      });
    return route.abort();
  });
  await page.route("https://i.ebayimg.com/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200"/>',
    }),
  );
});
test("three shopping paths, featured previews, newest 14 and hidden empty sections", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".shop-path")).toHaveCount(3);
  await expect(page.locator(".featured-card")).toHaveCount(3);
  await expect(page.locator("#catalog .art-card")).toHaveCount(14);
  await expect(page.locator("#journal")).toBeHidden();
  await expect(page.locator("#customer-feedback")).toBeHidden();
  await expect(page.locator("#art-in-use .example-card")).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator(".art-card .artwork-size")).toHaveCount(14);
  await expect(page.locator(".featured-card .artwork-size")).toHaveCount(3);
  expect(await page.locator(".category-nav").evaluate((el) => getComputedStyle(el).fontSize)).toBe(
    "16px",
  );
  await page.locator(".featured-card a").first().click();
  await expect(page.locator("#search")).toHaveCount(0);
  await expect(page.locator("#catalog .art-card")).toHaveCount(6);
});
test("NFT notification path records selected topics and explicit consent in existing inbox", async ({
  page,
}) => {
  await page.goto("/genre.html?genre=nft");
  await expect(page.locator("[data-buy]")).toHaveCount(0);
  await page.getByRole("link", { name: "Request NFT release notifications" }).first().click();
  await expect(page.locator("#studio-updates-form [name=nft]")).toBeChecked();
  await expect(page.locator("#studio-updates-form [name=studio]")).not.toBeChecked();
  await page.locator("#studio-updates-form [name=name]").fill("Fixture Customer");
  await page.locator("#studio-updates-form [name=email]").fill("fixture@example.invalid");
  await page.locator("#studio-updates-form [name=consent]").check();
  const sent = page.waitForRequest((r) => r.url().endsWith("/submit-message"));
  await page.locator("#studio-updates-form button").click();
  const payload = (await sent).postDataJSON();
  expect(payload.subject).toBe("NFT release notification opt-in");
  expect(payload.message).toContain("I consent");
  expect(payload.message).not.toContain("studio artwork and product updates");
  await expect(page.locator("#updates-status")).toContainText("signup request has been saved");
});
test("buyer information precedes the same digital Stripe checkout and physical links remain separate", async ({
  page,
}) => {
  await page.route("https://checkout.stripe.com/c/pay/studio-fixture", (r) =>
    r.fulfill({ contentType: "text/html", body: "<h1>Checkout fixture</h1>" }),
  );
  await page.goto("/genre.html?genre=fantasy");
  const card = page.locator(".art-card").first();
  await card.locator(".artwork-information summary").click();
  await expect(card.locator(".artwork-information")).toContainText("Nonexclusive");
  await expect(card.locator(".artwork-information")).toContainText("Not recorded");
  const sent = page.waitForRequest((r) => r.url().endsWith("/create-checkout"));
  await card.locator("[data-provider=stripe]").click();
  expect((await sent).postDataJSON().provider).toBe("stripe");
  await expect(page).toHaveURL("https://checkout.stripe.com/c/pay/studio-fixture");
  await page.goto("/");
  await expect(page.locator('#product-examples a[href="/canvases.html"]').first()).toHaveAttribute(
    "href",
    "/canvases.html",
  );
});
test("journal appears only with useful content and signup errors recover", async ({ page }) => {
  await page.route("**/rest/v1/articles?**", (r) =>
    r.fulfill({
      json: [
        {
          title: "From sketch to strange world",
          excerpt: "Studio notes",
          body: "A real article with useful content.",
        },
      ],
    }),
  );
  await page.goto("/");
  await expect(page.locator("#journal")).toBeVisible();
  await page.route("**/functions/v1/submit-message", (r) =>
    r.fulfill({ status: 500, json: { error: "Fixture failure" } }),
  );
  await page.locator("#studio-updates-form [name=name]").fill("Fixture");
  await page.locator("#studio-updates-form [name=email]").fill("fixture@example.invalid");
  await page.locator("#studio-updates-form [name=consent]").check();
  await page.locator("#studio-updates-form button").click();
  await expect(page.locator("#updates-status")).toContainText("couldn’t save");
  await expect(page.locator("#studio-updates-form button")).toBeEnabled();
});
test("customer quotes require purchase verification and publication consent", async ({ page }) => {
  await page.route("**/studio-feedback.json", (r) =>
    r.fulfill({
      json: [
        {
          name: "Fixture customer",
          quote: "A verified fixture quote.",
          product: "Canvas",
          published: true,
          permissionGranted: true,
          verifiedPurchase: true,
        },
        { name: "Not approved", quote: "Do not publish", published: true },
      ],
    }),
  );
  await page.goto("/");
  await expect(page.locator("#customer-feedback")).toBeVisible();
  await expect(page.locator(".customer-quote")).toHaveCount(1);
  await expect(page.locator("#customer-quotes")).not.toContainText("Do not publish");
});
test("updated homepage remains accessible", async ({ page }) => {
  await page.goto("/");
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(r.violations).toEqual([]);
});
