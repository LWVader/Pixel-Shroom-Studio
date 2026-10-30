import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const product = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Studio canvas",
  kind: "canvas",
  variant_label: "12 × 16 inch canvas",
  preview_url: "http://127.0.0.1:8020/assets/art-fantasy.png",
  retail_cents: 5000,
};
async function setup(page, category = "canvas") {
  await page.route("https://esm.sh/@supabase/supabase-js@2.57.4", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `export function createClient(){return {auth:{getSession:async()=>({data:{session:{access_token:'owner',user:{id:'owner',email:'test@example.com'}}}}),onAuthStateChange:()=>({})},from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:null,error:null})})}}`,
    }),
  );
  await page.route("**/functions/v1/print-api", (route) => {
    const body = route.request().postDataJSON();
    if (body.action === "catalog")
      return route.fulfill({
        json: { products: [{ ...product, kind: category }], enabled: true, testMode: true },
      });
    if (body.action === "quote")
      return route.fulfill({
        json: {
          quoteId: product.id,
          productCents: 5000,
          shipping: [
            { uid: "normal", name: "Standard delivery", cents: 700, minDays: 5, maxDays: 8 },
          ],
          testMode: true,
        },
      });
    if (body.action === "checkout")
      return route.fulfill({ json: { checkoutUrl: "https://checkout.stripe.com/print-test" } });
    return route.fulfill({ json: { orders: [] } });
  });
}
for (const [slug, kind] of [
  ["canvases", "canvas"],
  ["apparel", "apparel"],
])
  test(`${slug} uses Gelato physical products without exposing downloadable print files`, async ({
    page,
  }) => {
    await setup(page, kind);
    const requests = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.goto("/" + slug + ".html");
    await expect(page.locator(".print-product")).toHaveCount(1);
    await expect(page.locator("#print-status")).toContainText("Test shop");
    await expect(page.locator("[download]")).toHaveCount(0);
    expect(requests.some((url) => url.includes("/functions/v1/print-api"))).toBe(true);
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
        .violations,
    ).toEqual([]);
  });
test("shipping quote and checkout send product IDs, never a private file URL or client price", async ({
  page,
}) => {
  await setup(page);
  let quoteBody, checkoutBody;
  page.on("request", (request) => {
    if (!request.url().includes("/print-api")) return;
    const body = request.postDataJSON();
    if (body.action === "quote") quoteBody = body;
    if (body.action === "checkout") checkoutBody = body;
  });
  await page.route("https://checkout.stripe.com/**", (r) =>
    r.fulfill({ contentType: "text/html", body: "<h1>Print payment fixture</h1>" }),
  );
  await page.goto("/canvases.html");
  await page.getByRole("button", { name: "Choose delivery" }).click();
  for (const [key, value] of Object.entries({
    firstName: "Test",
    lastName: "Buyer",
    addressLine1: "1 Main Street",
    city: "Louisville",
    state: "KY",
    postCode: "40202",
  }))
    await page.locator(`[name=${key}]`).fill(value);
  await page.locator("[name=consent]").check();
  await page.getByRole("button", { name: "Request delivery quote" }).click();
  await expect(page.locator("#print-total")).toContainText("$57.00");
  await page.getByRole("button", { name: "Continue to test checkout" }).click();
  await expect(page).toHaveURL("https://checkout.stripe.com/print-test");
  expect(quoteBody.productId).toBe(product.id);
  expect(quoteBody.consent).toBe(true);
  expect(JSON.stringify(quoteBody)).not.toMatch(/print_path|signedUrl|retail_cents/);
  expect(checkoutBody).toEqual({
    action: "checkout",
    quoteId: product.id,
    shippingMethod: "normal",
  });
});
test("changing delivery information invalidates the earlier quote", async ({ page }) => {
  await setup(page);
  await page.goto("/canvases.html");
  await page.getByRole("button", { name: "Choose delivery" }).click();
  for (const [key, value] of Object.entries({
    firstName: "Test",
    lastName: "Buyer",
    addressLine1: "1 Main St",
    city: "Louisville",
    state: "KY",
    postCode: "40202",
  }))
    await page.locator(`[name=${key}]`).fill(value);
  await page.locator("[name=consent]").check();
  await page.getByRole("button", { name: "Request delivery quote" }).click();
  await expect(page.locator("#print-pay")).toBeVisible();
  await page.locator("[name=postCode]").fill("40203");
  await expect(page.locator("#print-pay")).toHaveCount(0);
});
test("physical order pages remain account-only", async ({ page }) => {
  await setup(page);
  await page.goto("/print-orders.html");
  await expect(page.locator("meta[name=robots]")).toHaveAttribute("content", "noindex,nofollow");
  await expect(page.locator("#print-order-status")).toContainText("no physical orders");
  await expect(page.locator("[download]")).toHaveCount(0);
});
