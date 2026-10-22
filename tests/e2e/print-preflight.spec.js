import { test, expect } from "@playwright/test";
import sharp from "sharp";
test("owner checks actual artwork, invalidates stale checks, and saves bound product evidence", async ({
  page,
}) => {
  const png = await sharp({
    create: {
      width: 600,
      height: 600,
      channels: 4,
      background: { r: 30, g: 90, b: 70, alpha: 0.7 },
    },
  })
    .png()
    .toBuffer();
  await page.route("https://esm.sh/@supabase/supabase-js@2.57.4", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `export function createClient(){return {
    auth:{getUser:async()=>({data:{user:{id:'owner'}}}),getSession:async()=>({data:{session:{access_token:'fixture-token'}}}),signOut:async()=>{}},
    storage:{from:()=>({uploadToSignedUrl:async()=>({error:null})})},
    from:()=>{const q={select:()=>q,is:()=>q,eq:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>({data:{user_id:'owner'}}),then:done=>done({data:[]})};return q;},rpc:async()=>({data:null})
  }}`,
    }),
  );
  await page.route("http://127.0.0.1:4179/**", (route) => route.abort());
  const calls = [];
  await page.route("**/functions/v1/print-api", (route) => {
    const body = route.request().postDataJSON();
    calls.push(body);
    if (body.action === "admin_upload")
      return route.fulfill({
        json: {
          path: `gelato/${body.productId}/11111111-1111-4111-8111-111111111111.png`,
          token: "upload",
        },
      });
    if (body.action === "admin_save") return route.fulfill({ json: { saved: true } });
    return route.fulfill({ json: { products: [], orders: [] } });
  });
  const gelatoRequests = [];
  page.on("request", (request) => {
    if (new URL(request.url()).hostname.endsWith("gelatoapis.com"))
      gelatoRequests.push(request.url());
  });
  await page.goto("/admin.html#images-view");
  const form = page.locator("#gelato-product-form");
  await form.locator("[name=title]").fill("Canvas preflight fixture");
  await form.locator("[name=variant_label]").fill("2 × 2 inch test area");
  await form.locator("[name=product_uid]").fill("canvas_fixture_uid");
  await form.locator("[name=price]").fill("30");
  await form.locator("[name=stripe_tax_code]").fill("txcd_99999999");
  await form
    .locator("[name=preview_url]")
    .fill("https://www.pixelshroomstudio.com/assets/art-fantasy.png");
  await form
    .locator("[name=templateUrl]")
    .fill("https://dashboard.gelato.com/catalogue/categories");
  await form.locator("[name=width]").fill("2");
  await form.locator("[name=height]").fill("2");
  await form
    .locator("[name=printFile]")
    .setInputFiles({ name: "private.png", mimeType: "image/png", buffer: png });
  await page.locator("#gelato-safe-check").click();
  await expect(page.locator("#gelato-preflight-result")).toContainText("300.0 effective PPI");
  await expect(page.locator("#gelato-preflight-result")).toHaveAttribute("data-state", "blocked");
  expect(calls).toEqual([]);
  expect(gelatoRequests).toEqual([]);
  for (const check of await form.locator("[data-preflight-review]").all()) await check.check();
  await page.locator("#gelato-safe-check").click();
  await expect(page.locator("#gelato-preflight-result")).toHaveAttribute("data-state", "ready");
  await page.locator("#gelato-preview-zoom").selectOption("2");
  await expect(page.locator("#gelato-preflight-result")).toHaveAttribute("data-state", "ready");
  await form.locator("[name=width]").fill("3");
  await expect(page.locator("#gelato-preflight-result")).toHaveAttribute("data-state", "stale");
  await page.locator("#gelato-safe-check").click();
  await expect(page.locator("#gelato-preflight-result")).toContainText("aspect ratio");
  await form.locator("[name=width]").fill("2");
  for (const check of await form.locator("[data-preflight-review]").all()) await check.check();
  await page.locator("#gelato-safe-check").click();
  await expect(page.locator("#gelato-preflight-result")).toHaveAttribute("data-state", "ready");
  await form.locator("[name=print_ready]").check();
  await form.locator("[name=active]").check();
  await form.getByRole("button", { name: "Save physical product mapping" }).click();
  await expect(page.locator("#gelato-admin-status")).toContainText("Product mapping saved");
  const saved = calls.find((c) => c.action === "admin_save").product;
  expect(saved.preflight_hash).toMatch(/^[a-f0-9]{64}$/);
  expect(saved.print_specs.width).toBe(2);
  expect(saved.preflight_reviews.edges).toBe(true);
  expect(saved.active).toBe(true);
  expect(gelatoRequests).toEqual([]);
});
