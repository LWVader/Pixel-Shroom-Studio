import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { inspectPrintBytes } from "../../public/print-preflight-core.js";
async function setup(page) {
  const bytes = await sharp({
    create: { width: 3000, height: 3000, channels: 3, background: "#407050" },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="3000"><rect x="120" y="120" width="2760" height="2760" rx="80" fill="#123e30" stroke="#d6a94f" stroke-width="45"/><circle cx="1500" cy="1300" r="750" fill="#d6a94f"/><circle cx="1250" cy="1100" r="180" fill="#f2ecdf"/><path d="M650 2350 L1500 1500 L2350 2350 Z" fill="#59ac86"/></svg>',
        ),
      },
    ])
    .png()
    .toBuffer();
  const facts = {
    ...inspectPrintBytes(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  const art = {
    id: 1,
    title: "Studio test artwork",
    artist: "LWVader",
    category: "Fantasy",
    serial_number: "LWV-0000000001",
    price: 8,
    status: "published",
    preview_url: "/fixtures/tier.png",
    display_width: 512,
    display_height: 512,
  };
  await page.route("https://esm.sh/@supabase/supabase-js@2.57.4", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `export function createClient(){return {
    auth:{getUser:async()=>({data:{user:{id:'owner'}}}),getSession:async()=>({data:{session:{access_token:'fixture-token'}}}),signOut:async()=>{}},
    storage:{from:()=>({uploadToSignedUrl:async()=>({error:null})})},
    from:table=>{const q={select:()=>q,is:()=>q,eq:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>({data:{user_id:'owner'}}),then:done=>done({data:table==='artworks'?[${JSON.stringify(art)}]:[]})};return q;},rpc:async()=>({data:null})
  }}`,
    }),
  );
  await page.route("http://127.0.0.1:4179/**", (route) => route.abort());
  await page.route("**/fixtures/**", (route) =>
    route.fulfill({ contentType: "image/png", body: bytes }),
  );
  const calls = [],
    errors = [],
    external = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).hostname.endsWith("gelatoapis.com")) external.push(request.url());
  });
  let serial = 0;
  await page.route("**/functions/v1/print-api", (route) => {
    const body = route.request().postDataJSON();
    calls.push(body);
    if (body.action === "admin_product")
      return route.fulfill({
        json: {
          product: {
            productUid: body.productUid,
            attributes: { CanvasFormat: "square", FrameColor: "selected" },
            supportedCountries: ["US"],
          },
        },
      });
    if (body.action === "admin_source")
      return route.fulfill({
        json: {
          path: `gelato/${body.productId}/11111111-1111-4111-8111-111111111111.png`,
          facts,
          previewUrl: "http://127.0.0.1:8020/fixtures/tier.png",
        },
      });
    if (body.action === "admin_upload")
      return route.fulfill({
        json: {
          path: `gelato/${body.productId}/11111111-1111-4111-8111-${String(++serial).padStart(12, "0")}.${body.extension}`,
          token: "fixture",
        },
      });
    if (body.action === "admin_preview_upload")
      return route.fulfill({
        json: {
          path: "gelato/protected.webp",
          token: "fixture",
          publicUrl: "http://127.0.0.1:8020/fixtures/preview.webp",
        },
      });
    if (body.action === "admin_save") return route.fulfill({ json: { saved: true } });
    return route.fulfill({ json: { products: [], orders: [] } });
  });
  await page.goto("/admin.html#images-view");
  await expect(page.locator("#art-form [name=artist]")).toHaveValue("LWVader");
  if (page.viewportSize().width < 1050) await page.locator("#sidebar-toggle").click();
  await page.getByRole("button", { name: "Gelato", exact: true }).click();
  return { bytes, facts, calls, errors, external, form: page.locator("#gelato-product-form") };
}
async function selectSiteArtwork(page) {
  if (!(await page.getByRole("button", { name: "Browse site artwork", exact: true }).isVisible()))
    await page.getByText("Browse artwork thumbnails", { exact: true }).click();
  await page.getByRole("button", { name: "Browse site artwork", exact: true }).click();
  await page.locator("[data-site-art='1']").click();
  await expect(page.locator("#gelato-source-status")).toContainText("Same file and SHA-256");
}
test("site browser, position preview, saved composition and confirmed publishing", async ({
  page,
}) => {
  test.slow();
  const { facts, calls, errors, external, form } = await setup(page);
  await selectSiteArtwork(page);
  await expect(
    form.locator("[name=price], [data-preflight-review], [name=active], [name=print_ready]"),
  ).toHaveCount(0);
  await expect(
    form.locator(".print-preflight, #gelato-size-preset, [name=width], [name=height]"),
  ).toHaveCount(0);
  await expect(page.locator("#gelato-product-size")).toContainText("16 × 16 thick");
  await expect(page.locator("#gelato-product-choice option")).toHaveCount(7);
  await expect(form.locator("[name=product_uid]")).toHaveValue(
    "canvas_400x400-mm-16x16-inch_canvas_wood-fsc-thick_4-0_ver",
  );
  await expect(form.locator("[name=stripe_tax_code]")).toHaveValue("txcd_99999999");
  await page.locator("#gelato-product-choice").selectOption({ label: "24 × 24 · Natural frame" });
  await expect(form.locator("[name=edition_tier]")).toHaveValue("Prismatic");
  await expect(form.locator("[name=frame_finish]")).toHaveValue("natural");
  await expect(page.locator("#gelato-product-size")).toContainText("24 × 24");
  await page
    .locator("#gelato-product-choice")
    .selectOption({ label: "16 × 24 portrait · Black frame" });
  await expect(form.locator("[name=edition_tier]")).toHaveValue("Emerald");
  await expect(page.locator("#gelato-product-size")).toContainText("16 × 24");
  await page
    .locator("#gelato-product-choice")
    .selectOption({ label: "16 × 16 · Thick canvas · Unframed" });
  await expect(form.locator("[name=edition_tier]")).toHaveValue("Standard");
  await selectSiteArtwork(page);
  await form.getByText("Advanced product details & tax", { exact: true }).click();
  await form.locator("[name=product_uid]").fill("canvas_fixture_uid");
  await page.getByRole("button", { name: "Load Gelato product", exact: true }).click();
  await expect(page.locator("#gelato-product-summary")).toContainText("Loaded from Gelato");

  await form.locator("[name=stripe_tax_code]").fill("txcd_99999999");
  await page.getByRole("button", { name: "Preview canvas", exact: true }).click();
  await expect(page.locator("#gelato-mockup-image")).toBeVisible();
  if (process.env.ADMIN_VISUAL_CHECK)
    await page
      .locator("#gelato-product-preview-dialog")
      .screenshot({ path: `/tmp/gelato-mockup-${page.viewportSize().width}.png` });
  await page.getByRole("button", { name: "On a wall", exact: true }).click();
  await expect(page.locator("#gelato-preview-scene")).toHaveAttribute("data-view", "wall");
  await page.locator("#gelato-close-product-preview").click();
  await page.locator("#gelato-position-zoom").fill("1.1");
  await page.getByRole("button", { name: "Save image position", exact: true }).click();
  await expect(page.locator("#gelato-position-status")).toContainText("Position saved:");
  await expect(form.locator("[name=preview_url]")).toHaveValue(/fixtures\/preview.webp/);
  if (process.env.ADMIN_VISUAL_CHECK)
    await page
      .locator(".gelato-editor-layout")
      .screenshot({ path: `/tmp/gelato-editor-${page.viewportSize().width}.png` });
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
    active: true,
    publish_confirmed: true,
    use_tier_source: true,
    position: { source_sha256: facts.sha256, zoom: 1.1 },
  });
  expect(product).not.toHaveProperty("retail_cents");
  await page.locator("#gelato-position-zoom").fill("1.2");
  await form.getByRole("button", { name: "Publish product", exact: true }).click();
  await expect(page.locator("#gelato-admin-status")).toContainText("Save image position first");
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("computer file chooser opens, supports positioned upload and rejects resolution inflation", async ({
  page,
}) => {
  test.slow();
  const { bytes, calls, errors, form } = await setup(page);
  await selectSiteArtwork(page);
  await form.getByText("Advanced product details & tax", { exact: true }).click();
  await form.locator("[name=product_uid]").fill("canvas_fixture_uid");
  await page.getByRole("button", { name: "Load Gelato product", exact: true }).click();
  await expect(page.locator("#gelato-product-summary")).toContainText("Loaded from Gelato");
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    form.locator("[name=printFile]").click(),
  ]);
  await chooser.setFiles({ name: "computer-art.png", mimeType: "image/png", buffer: bytes });
  await expect(page.locator("#gelato-source-status")).toContainText("computer-art.png");
  await page.locator("#gelato-position-zoom").fill("2");
  await page.getByRole("button", { name: "Save image position", exact: true }).click();
  await expect(page.locator("#gelato-position-status")).toContainText("93.8 PPI");
  expect(calls.filter((c) => c.action === "admin_upload")).toHaveLength(0);
  await page.locator("#gelato-position-reset").click();
  await page.getByRole("button", { name: "Save image position", exact: true }).click();
  await expect(page.locator("#gelato-position-status")).toContainText("Position saved:");
  expect(calls.filter((c) => c.action === "admin_upload")).toHaveLength(2);
  await form.locator("[name=edition_tier]").selectOption("Emerald");
  await expect(page.locator("#gelato-product-size")).toContainText("16 × 24 portrait canvas");
  await expect(page.locator("#gelato-product-choice option")).toHaveCount(7);
  await page
    .locator("#gelato-product-choice")
    .selectOption({ label: "16 × 24 portrait · Dark Wood frame" });
  await expect(form.locator("[name=frame_finish]")).toHaveValue("dark-wood");
  await expect(form.locator("[name=product_uid]")).toHaveValue(
    "framed_canvas_geo_simplified_400x600-mm-16x24-inch_dark-wood_452x652-mm-18x26-inch_wood-fsc-slim_ver_wood_w14xt42-mm_canvas_4-0",
  );
  await page
    .locator("#gelato-product-choice")
    .selectOption({ label: "16 × 24 portrait · Natural frame" });
  await expect(page.locator("#gelato-product-size")).toContainText("Natural frame");
  await form.locator("[name=edition_tier]").selectOption("Prismatic");
  await expect(page.locator("#gelato-product-size")).toContainText("24 × 24");
  await form.locator("[name=product_uid]").fill("canvas_prismatic_natural");
  await page.getByRole("button", { name: "Load Gelato product", exact: true }).click();
  await expect(page.locator("#gelato-product-summary")).toContainText("Loaded from Gelato");
  await page.getByRole("button", { name: "Save image position", exact: true }).click();
  await expect(page.locator("#gelato-position-status")).toContainText("125.0 PPI");
  expect(errors).toEqual([]);
});
