import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { inspectPrintBytes } from "../../public/print-preflight-core.js";
test("shared tier image, automatic checks, cancel/confirm publish and fixed roll pricing", async ({
  page,
}) => {
  test.slow();
  const bytes = await sharp({
    create: { width: 2400, height: 2400, channels: 3, background: "#407050" },
  })
    .png()
    .toBuffer();
  const facts = {
    ...inspectPrintBytes(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  await page.route("https://esm.sh/@supabase/supabase-js@2.57.4", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `export function createClient(){return {
    auth:{getUser:async()=>({data:{user:{id:'owner'}}}),getSession:async()=>({data:{session:{access_token:'fixture-token'}}}),signOut:async()=>{}},
    from:()=>{const q={select:()=>q,is:()=>q,eq:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>({data:{user_id:'owner'}}),then:done=>done({data:[]})};return q;},rpc:async()=>({data:null})
  }}`,
    }),
  );
  await page.route("http://127.0.0.1:4179/**", (route) => route.abort());
  const calls = [],
    providerRequests = [];
  page.on("request", (request) => {
    if (new URL(request.url()).hostname.endsWith("gelatoapis.com"))
      providerRequests.push(request.url());
  });
  await page.route("**/functions/v1/print-api", (route) => {
    const body = route.request().postDataJSON();
    calls.push(body);
    if (body.action === "admin_source")
      return route.fulfill({
        json: {
          path: `gelato/${body.productId}/11111111-1111-4111-8111-111111111111.png`,
          facts,
          previewUrl: "http://127.0.0.1:8020/assets/art-fantasy.png",
        },
      });
    if (body.action === "admin_save") return route.fulfill({ json: { saved: true } });
    return route.fulfill({ json: { products: [], orders: [] } });
  });
  await page.goto("/admin.html#images-view");
  await expect(page.locator("#art-form [name=artist]")).toHaveValue("LWVader");
  await expect(page.locator("#art-form [name=price]")).toHaveCount(0);
  await expect(page.locator("#images-view #gelato-product-form")).toHaveCount(0);
  await page.getByRole("button", { name: "Gelato", exact: true }).click();
  const form = page.locator("#gelato-product-form");
  await expect(
    form.locator("[data-preflight-review], [name=price], [name=active], [name=print_ready]"),
  ).toHaveCount(0);
  await form.getByText("Shared artwork ID", { exact: true }).click();
  await form.locator("[name=edition_artwork_id]").fill("1");
  await form.locator("[name=edition_tier]").selectOption("Standard");
  await expect(page.locator("#gelato-source-status")).toContainText("Same file and SHA-256");
  await expect(page.locator("#gelato-check-image")).toBeVisible();
  await form.locator("[name=title]").fill("Shared source canvas");
  await form.locator("[name=product_uid]").fill("canvas_fixture_uid");
  await form.getByText("Listing details & tax", { exact: true }).click();
  await form.locator("[name=stripe_tax_code]").fill("txcd_99999999");
  await form
    .locator("[name=preview_url]")
    .fill("https://www.pixelshroomstudio.com/assets/art-fantasy.png");
  await form
    .getByText("Technical settings — confirm against the Gelato template", { exact: true })
    .click();
  await form
    .locator("[name=templateUrl]")
    .fill("https://dashboard.gelato.com/catalogue/categories");
  await form.locator("[name=width]").fill("17");
  await form.getByRole("button", { name: "Publish product", exact: true }).click();
  await expect(page.locator("#gelato-preflight-result")).toContainText("aspect ratio");
  expect(calls.some((c) => c.action === "admin_save")).toBe(false);
  await form.locator("[name=width]").fill("16");
  page.once("dialog", (dialog) => dialog.dismiss());
  await form.getByRole("button", { name: "Publish product", exact: true }).click();
  await expect(page.locator("#gelato-admin-status")).toContainText("Publishing cancelled");
  expect(calls.some((c) => c.action === "admin_save")).toBe(false);
  page.once("dialog", (dialog) => dialog.accept());
  await form.getByRole("button", { name: "Publish product", exact: true }).click();
  await expect(page.locator("#gelato-admin-status")).toContainText("Product published");
  const product = calls.find((c) => c.action === "admin_save").product;
  expect(product).toMatchObject({
    edition_artwork_id: 1,
    edition_tier: "Standard",
    preflight_hash: facts.sha256,
    active: true,
    publish_confirmed: true,
    use_tier_source: true,
  });
  expect(product).not.toHaveProperty("retail_cents");
  expect(product).not.toHaveProperty("preflight_reviews");
  expect(calls.some((c) => c.action === "admin_upload")).toBe(false);
  expect(providerRequests).toEqual([]);
});
