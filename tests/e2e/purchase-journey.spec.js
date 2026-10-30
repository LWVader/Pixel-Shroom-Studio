// Complete UI journey with isolated provider fixtures. No real charges or orders.
import { test, expect } from "@playwright/test";
import { orderPayload, recipientFor } from "../../supabase/functions/_shared/gelato-core.ts";
import { canvasProduct } from "../../public/canvas-products-core.js";
import { GELATO_PRODUCT_OPTIONS } from "../../public/gelato-product-options.js";
const origin = "http://127.0.0.1:8020";
const owner = "11111111-1111-4111-8111-111111111111";
const mintId = "22222222-2222-4222-8222-222222222222";
const printId = "33333333-3333-4333-8333-333333333333";
const imageUrl =
  "https://decizwtgsqhjdgjiqbui.supabase.co/storage/v1/object/sign/minted/fixture.png?token=fixture";
const returnUrl = origin + "/checkout-success.html?order=fixture&access=fixture";
const shipping = {
  firstName: "Test",
  lastName: "Collector",
  addressLine1: "123 Main St",
  addressLine2: "",
  city: "Boston",
  state: "MA",
  postCode: "02108",
  phone: "",
};
for (const tier of ["Standard", "Silver", "Gold", "Emerald", "Sapphire", "Prismatic"]) {
  const offer = tier === "Emerald" ? "digital" : "canvas";
  test(`${tier}: ${offer} payment → one reveal → Vault → saved shipping → Gelato draft`, async ({
    page,
  }) => {
    test.slow();
    let recipient = null,
      paid = false,
      draft = null,
      printPaid = false;
    let quoteBody,
      checkoutBody,
      rollBody,
      statusRequests = 0;
    const errors = [],
      events = [],
      draftCalls = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      window.journeyScenes = new Set();
      new MutationObserver(() =>
        document
          .querySelectorAll('.foil-scene[data-animation="running"]')
          .forEach((s) => window.journeyScenes.add(s)),
      ).observe(document, { subtree: true, childList: true, attributes: true });
    });
    await page.route("https://esm.sh/@supabase/supabase-js@2.57.4", (r) =>
      r.fulfill({
        contentType: "text/javascript",
        body: `
      const user={id:'${owner}',email:'collector@example.com'};
      export function createClient(){return {
       auth:{getSession:async()=>({data:{session:{user,access_token:'fixture'}}}),getUser:async()=>({data:{user}}),onAuthStateChange:()=>({}),signOut:async()=>{}},
       rpc:async()=>({data:[]}),from:table=>{const q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>({data:await(await fetch('/fixture-profile')).json()}),upsert:async(row)=>{await fetch('/fixture-profile',{method:'POST',body:JSON.stringify(row)});return {error:null}},then:done=>done({data:[]})};return q;}
      }}`,
      }),
    );
    await page.route("**/fixture-profile", async (r) => {
      if (r.request().method() === "POST") recipient = r.request().postDataJSON().recipient;
      return r.fulfill({ json: recipient ? { recipient } : null });
    });
    await page.route("**/functions/v1/forge-api", (r) =>
      r.fulfill({
        json: {
          paymentMode: "test",
          digitalEnabled: true,
          canvasEnabled: true,
          canvasMappingsReady: true,
          edition: {
            artworkId: 1,
            enabled: true,
            maxSupply: 500,
            totalMinted: 0,
            reserved: 0,
            prismaticsRemaining: 5,
            rulesVersion: 2,
          },
          previews: [],
        },
      }),
    );
    await page.route("**/functions/v1/mint-checkout", (r) => {
      rollBody = r.request().postDataJSON();
      events.push("checkout-created");
      return r.fulfill({
        json: { checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_roll_fixture" },
      });
    });
    await page.route("https://checkout.stripe.com/**", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: `<!doctype html><title>TEST provider fixture</title><h1>Simulated Stripe TEST checkout</h1><a href="${origin}/${r.request().url().includes("print_fixture") ? "fixture-print-paid" : "fixture-roll-paid"}">Confirm test payment</a>`,
      }),
    );
    await page.route("**/fixture-roll-paid", (r) => {
      paid = true;
      events.push("payment-confirmed");
      return r.fulfill({ status: 302, headers: { location: returnUrl } });
    });
    const item = {
      id: mintId,
      title: "Portrait artwork 1",
      tier,
      state: "ready",
      mintNumber: 1,
      maxSupply: 500,
      width: 4800,
      height: 4800,
      imageUrl,
      paymentConfirmed: true,
      inCollection: true,
      manifest: { payload: { mintId }, signature: "fixture" },
    };
    await page.route("**/functions/v1/order-status", (r) =>
      r.fulfill({
        json: {
          status: paid ? "paid" : "pending",
          kind: "foil",
          mint: { id: mintId, state: paid ? "ready" : "queued" },
        },
      }),
    );
    await page.route("**/functions/v1/mint-access", (r) => {
      const b = r.request().postDataJSON();
      return r.fulfill({
        json: { items: b.action === "uncollected" ? [] : paid ? [item] : [], hasMore: false },
      });
    });
    await page.route("**/storage/v1/object/sign/minted/**", (r) =>
      r.fulfill({ path: "public/assets/art-fantasy.png", contentType: "image/png" }),
    );
    const productOptions = GELATO_PRODUCT_OPTIONS.filter((p) => p.tiers.includes(tier));
    const products = productOptions.map((p, i) => ({
      id: `44444444-4444-4444-8444-${String(i + 1).padStart(12, "0")}`,
      title: item.title,
      kind: "canvas",
      variant_label: p.label,
      preview_url: origin + "/assets/art-fantasy.png",
      retail_cents: offer === "canvas" ? 0 : 7900,
      product_uid: p.uid,
      frame: p.frame,
    }));
    function createDraft() {
      if (draft) return;
      const p = products.find((p) => p.id === quoteBody.productId);
      draft = orderPayload(
        {
          id: printId,
          owner_id: owner,
          test_mode: true,
          payment_state: "paid",
          fulfillment_state: "submitting",
          quantity: 1,
          shipment_method_uid: "normal",
          recipient: recipientFor(quoteBody.recipient, "collector@example.com"),
          product_snapshot: { product_uid: p.product_uid },
        },
        "https://private-print.invalid/positioned-composition.png?token=fixture",
        false,
      );
      draftCalls.push(draft);
      events.push("gelato-draft");
    }
    await page.route("**/fixture-print-paid", (r) => {
      printPaid = true;
      createDraft();
      return r.fulfill({
        status: 302,
        headers: { location: origin + "/collection.html?tab=orders&order=" + printId },
      });
    });
    await page.route("**/functions/v1/print-api", (r) => {
      const b = r.request().postDataJSON();
      if (b.action === "catalog")
        return r.fulfill({
          json: {
            products,
            enabled: true,
            testMode: true,
            canvasClaim: offer === "canvas" ? "available" : null,
          },
        });
      if (b.action === "quote") {
        quoteBody = b;
        events.push("delivery-quoted");
        return r.fulfill({
          json: {
            quoteId: printId,
            prepaid: offer === "canvas",
            productCents: offer === "canvas" ? 0 : 7900,
            testMode: true,
            shipping: [
              {
                uid: "normal",
                name: offer === "canvas" ? "Included US shipping" : "US delivery",
                cents: offer === "canvas" ? 0 : 1349,
              },
            ],
          },
        });
      }
      if (b.action === "checkout") {
        checkoutBody = b;
        if (offer === "canvas") {
          createDraft();
          return r.fulfill({
            json: {
              redeemed: true,
              orderUrl: origin + "/collection.html?tab=orders&order=" + printId,
            },
          });
        }
        return r.fulfill({
          json: { checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_print_fixture" },
        });
      }
      return r.fulfill({
        json: {
          orders: draft
            ? [
                {
                  id: printId,
                  title: item.title,
                  variant: products.find((p) => p.id === quoteBody.productId).variant_label,
                  quantity: 1,
                  paymentState: "paid",
                  state: "accepted",
                  status: "draft",
                  testMode: true,
                },
              ]
            : [],
        },
      });
    });
    // Save a private shipping default before selecting the artwork.
    await page.goto("/collection.html?tab=account");
    const address = page.locator("#vault-shipping-form");
    await expect(address).toBeVisible();
    for (const [key, value] of Object.entries(shipping))
      if (key !== "state") await address.locator(`[name=${key}]`).fill(value);
    await address.locator("[name=state]").selectOption("MA");
    await address.getByRole("button", { name: "Save delivery address" }).click();
    await expect(page.locator("#account-status")).toContainText("Delivery address saved");
    await page.goto("/art.html?id=1&offer=" + offer);
    await expect(page.locator("#roll-purchase [type=submit]")).toBeEnabled();
    await page.locator("#roll-purchase [type=submit]").click();
    await expect(page).toHaveURL(/checkout.stripe.com/);
    expect(rollBody).toEqual({ artworkId: "1", offer });
    expect(draftCalls).toHaveLength(0);
    // A return URL alone never establishes payment or reveals a result.
    await page.goto(returnUrl);
    await expect(page.locator("#checkout-message")).toContainText(
      "only after payment is verified",
      { useInnerText: true },
    );
    await expect(page.locator(".foil-scene")).toHaveCount(0);
    await page.goto("https://checkout.stripe.com/c/pay/cs_test_roll_fixture");
    await page.getByRole("link", { name: "Confirm test payment" }).click();
    await expect(page.locator(".foil-scene")).toHaveCount(1);
    await expect(page.locator(".foil-purchase-actions")).toBeHidden();
    await expect(page.locator("#checkout-heading")).toHaveText(`${tier} edition revealed`, {
      timeout: 20000,
    });
    expect(await page.evaluate(() => window.journeyScenes.size)).toBe(1);
    await page.getByRole("link", { name: "Open My Vault", exact: true }).click();
    await expect(page.locator("#mint-collection .foil-card")).toHaveCount(1);
    await expect(page.locator("#mint-collection .foil-card")).toContainText(tier);
    await page
      .locator("#mint-collection")
      .getByRole("link", { name: "Print this edition" })
      .click();
    const chosen = products.find((p) => p.frame === "natural") || products[0];
    await page.locator(`[data-print-product="${chosen.id}"]`).click();
    await expect(page.locator("#print-quote-form [name=addressLine1]")).toHaveValue(
      shipping.addressLine1,
    );
    await expect(page.locator("#print-quote-form [name=postCode]")).toHaveValue(shipping.postCode);
    await expect(page.locator("[name=consent]")).not.toBeChecked();
    await page.locator("[name=consent]").check();
    await page.getByRole("button", { name: "Request delivery quote" }).click();
    expect(draftCalls).toHaveLength(0);
    await page.locator("#print-pay").click();
    if (offer === "digital") {
      await expect(page).toHaveURL(/cs_test_print_fixture/);
      expect(draftCalls).toHaveLength(0);
      await page.getByRole("link", { name: "Confirm test payment" }).click();
      expect(printPaid).toBe(true);
    }
    await expect(page.locator("#print-order-list")).toContainText("draft");
    expect(draftCalls).toHaveLength(1);
    expect(draft.orderType).toBe("draft");
    expect(draft.currency).toBe("USD");
    expect(draft.items[0].productUid).toBe(chosen.product_uid);
    expect(draft.items[0].files[0].url).not.toBe(imageUrl);
    expect(draft.shippingAddress).toMatchObject({
      ...recipientFor({ ...shipping, country: "US" }, "collector@example.com"),
    });
    expect(quoteBody.mintId).toBe(mintId);
    expect(JSON.stringify(quoteBody)).not.toMatch(/print_path|signedUrl|retail_cents/);
    expect(checkoutBody).toEqual({
      action: "checkout",
      quoteId: printId,
      shippingMethod: "normal",
    });
    expect(events.indexOf("payment-confirmed")).toBeLessThan(events.indexOf("gelato-draft"));
    const profile = canvasProduct(tier, chosen.frame);
    expect(profile.height).toBe(["Emerald", "Sapphire", "Prismatic"].includes(tier) ? 24 : 16);
    await page.reload();
    await expect(page.locator("#print-order-list")).toContainText("draft");
    expect(draftCalls).toHaveLength(1);
    expect(errors).toEqual([]);
  });
}
