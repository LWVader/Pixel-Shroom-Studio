import { it, expect } from "vitest";
import {
  recipientFor,
  quotePayload,
  shippingOptions,
  orderPayload,
} from "../../supabase/functions/_shared/gelato-core.ts";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const recipient = {
  country: "US",
  firstName: "Test",
  lastName: "Buyer",
  addressLine1: "1 Main St",
  city: "Louisville",
  state: "KY",
  postCode: "40202",
};
const product = {
  product_uid: "canvas_fixture",
  retail_cents: 5000,
  print_path: "private/never-public.png",
};
it("builds documented v4 quote/order payloads and enforces physical fulfillment boundaries", () => {
  const address = recipientFor(recipient, "buyer@example.test");
  const payload = quotePayload(
    "quote",
    "owner",
    product,
    2,
    address,
    "https://private.invalid/temporary",
  );
  expect(payload.products[0].productUid).toBe("canvas_fixture");
  expect(payload.recipient.email).toBe("buyer@example.test");
  expect(payload).not.toHaveProperty("shippingAddress");
  expect(() => recipientFor({ ...recipient, country: "GB" }, "buyer@example.test")).toThrow();
  expect(() => quotePayload("q", "o", product, 99, address, "https://private.invalid")).toThrow();
  const order = {
    id: "order",
    owner_id: "owner",
    product_snapshot: product,
    quantity: 2,
    recipient: address,
    shipment_method_uid: "normal",
    payment_state: "paid",
    fulfillment_state: "submitting",
    test_mode: true,
  };
  expect(orderPayload(order, "https://private.invalid", false).orderType).toBe("draft");
  expect(() =>
    orderPayload({ ...order, test_mode: false }, "https://private.invalid", false),
  ).toThrow();
  expect(() =>
    orderPayload({ ...order, payment_state: "pending" }, "https://private.invalid", true),
  ).toThrow();
  expect(
    orderPayload({ ...order, test_mode: false }, "https://private.invalid", true).orderType,
  ).toBe("order");
});
it("rejects mismatched quote currencies, split quotes and underpriced mappings", () => {
  const quote = {
    quotes: [
      {
        products: [{ productUid: "canvas_fixture", quantity: 1, currency: "USD", price: 20 }],
        shipmentMethods: [
          { shipmentMethodUid: "normal", currency: "USD", price: 7, name: "Standard" },
        ],
      },
    ],
  };
  expect(shippingOptions(quote, product, 1)[0].cents).toBe(700);
  expect(() =>
    shippingOptions({ ...quote, quotes: [...quote.quotes, ...quote.quotes] }, product, 1),
  ).toThrow();
  expect(() => shippingOptions(quote, { ...product, retail_cents: 100 }, 1)).toThrow();
  expect(() =>
    shippingOptions(
      {
        quotes: [
          { ...quote.quotes[0], products: [{ ...quote.quotes[0].products[0], currency: "EUR" }] },
        ],
      },
      product,
      1,
    ),
  ).toThrow();
});
it("reserves quotes once and verifies payment amount, ownership, mode and single submission in PostgreSQL", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function public.is_admin() returns boolean language sql as $$select false$$;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(bucket_id text);`,
    );
    await db.exec(readFileSync("supabase/migrations/202610210002_gelato_print_orders.sql", "utf8"));
    const owner = "11111111-1111-4111-8111-111111111111",
      other = "22222222-2222-4222-8222-222222222222",
      id = "33333333-3333-4333-8333-333333333333";
    await db.query("insert into auth.users values($1),($2)", [owner, other]);
    await db.query(
      `insert into gelato_products(id,title,kind,variant_label,product_uid,preview_url,print_path,retail_cents,stripe_tax_code,active,print_ready)values($1,'Canvas','canvas','12x16','canvas_fixture','https://studio.invalid/preview.png','gelato/source.png',5000,'txcd_99999999',true,true)`,
      [id],
    );
    const q = (
      await db.query(
        `insert into gelato_quotes(owner_id,product_id,product_snapshot,quantity,recipient,state,shipping_options,test_mode)values($1,$2,$3,1,$4,'ready','[{"uid":"normal","cents":700}]',true)returning id`,
        [owner, id, JSON.stringify(product), JSON.stringify(recipient)],
      )
    ).rows[0].id;
    await expect(
      db.query("select reserve_gelato_checkout($1,$2,$3)", [q, other, "normal"]),
    ).rejects.toThrow("Quote not found");
    const reserve = async () =>
      (await db.query("select reserve_gelato_checkout($1,$2,$3) o", [q, owner, "normal"])).rows[0]
        .o;
    const order = await reserve();
    expect((await reserve()).id).toBe(order.id);
    await db.query("update gelato_orders set stripe_session='cs_test_fixture' where id=$1", [
      order.id,
    ]);
    const pay = (subtotal, live, event = "evt_1") =>
      db.query("select claim_gelato_payment($1,'cs_test_fixture',$2,$3,'usd',$4,'pi_fixture')", [
        order.id,
        event,
        subtotal,
        live,
      ]);
    await expect(pay(1, false)).rejects.toThrow("mismatch");
    await expect(pay(5700, true)).rejects.toThrow("mismatch");
    await pay(5700, false);
    await pay(5700, false);
    expect(
      (await db.query("select claim_gelato_submission($1) o", [order.id])).rows[0].o
        .fulfillment_state,
    ).toBe("submitting");
    expect((await db.query("select claim_gelato_submission($1) o", [order.id])).rows[0].o).toBe(
      null,
    );
    expect((await db.query("select count(*)::int n from gelato_events")).rows[0].n).toBe(1);
    expect((await db.query("select * from gelato_storefront_products")).rows[0]).not.toHaveProperty(
      "print_path",
    );
    expect(
      (await db.query("select public from storage.buckets where id='gelato-print-files'")).rows[0]
        .public,
    ).toBe(false);
  } finally {
    await db.close();
  }
});

it("runs sandbox fulfillment once and quarantines ambiguous create responses", async () => {
  const { execFileSync } = await import("node:child_process");
  expect(
    execFileSync(process.execPath, ["tests/gelato-fulfillment.cjs"], { encoding: "utf8" }),
  ).toContain("PASS");
});
