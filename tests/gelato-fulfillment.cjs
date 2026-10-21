const ts = require("typescript"),
  fs = require("fs"),
  vm = require("vm"),
  assert = require("node:assert/strict");
function compile(file) {
  return ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
}
const core = { exports: {} };
vm.runInNewContext(compile("supabase/functions/_shared/gelato-core.ts"), { exports: core.exports });
async function run(fail) {
  const order = {
    id: "order-1",
    owner_id: "owner-1",
    test_mode: true,
    payment_state: "paid",
    fulfillment_state: "queued",
    quantity: 1,
    shipping_cents: 700,
    shipment_method_uid: "normal",
    recipient: { country: "US" },
    product_snapshot: {
      product_uid: "canvas_fixture",
      retail_cents: 5000,
      print_path:
        "gelato/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.png",
    },
  };
  let creates = 0,
    submitted;
  const db = {
    storage: {
      from: () => ({
        createSignedUrl: async () => ({
          data: { signedUrl: "https://private-print.invalid/source?token=fixture" },
        }),
      }),
    },
    rpc: async (name) => {
      assert.equal(name, "claim_gelato_submission");
      if (order.fulfillment_state !== "queued") return { data: null };
      order.fulfillment_state = "submitting";
      return { data: { ...order } };
    },
    from: () => ({
      update: (data) => {
        const q = {
          eq: () => q,
          then: (resolve) => {
            Object.assign(order, data);
            return Promise.resolve(resolve({ error: null }));
          },
        };
        return q;
      },
    }),
  };
  const module = { exports: {} };
  vm.runInNewContext(compile("supabase/functions/_shared/gelato.ts"), {
    exports: module.exports,
    require: (name) => (name.includes("gelato-core") ? core.exports : {}),
    Deno: {
      env: { get: (name) => ({ GELATO_API_KEY: "private-key", GELATO_MODE: "sandbox" })[name] },
    },
    fetch: async (url, options) => {
      assert.ok(url.startsWith("https://order.gelatoapis.com/v4/"));
      const payload = JSON.parse(options.body);
      if (url.endsWith("orders:quote"))
        return Response.json({
          quotes: [
            {
              products: [{ productUid: "canvas_fixture", quantity: 1, currency: "USD", price: 20 }],
              shipmentMethods: [{ currency: "USD", price: 7, shipmentMethodUid: "normal" }],
            },
          ],
        });
      creates++;
      submitted = payload;
      if (fail) throw Error("Timeout after provider accepted request");
      return Response.json({
        id: "gelato-1",
        orderReferenceId: order.id,
        customerReferenceId: order.owner_id,
        fulfillmentStatus: "draft",
      });
    },
    AbortSignal,
    URL,
    console,
  });
  await module.exports.submitPaidPrint(db, order.id);
  await module.exports.submitPaidPrint(db, order.id);
  assert.equal(creates, 1);
  assert.equal(submitted.orderType, "draft");
  assert.equal(
    submitted.items[0].files[0].url,
    "https://private-print.invalid/source?token=fixture",
  );
  assert.equal(order.fulfillment_state, fail ? "needs_review" : "accepted");
  if (!fail) assert.equal(order.gelato_id, "gelato-1");
  let calls = [];
  const verifyDb = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: null };
    },
  };
  await module.exports.completePrintSession(verifyDb, { payment_status: "unpaid" }, "evt");
  assert.equal(calls.length, 0);
  await module.exports.completePrintSession(
    verifyDb,
    {
      payment_status: "paid",
      metadata: { print_order_id: "order" },
      id: "cs_test",
      amount_subtotal: 5000,
      total_details: { amount_shipping: 700 },
      amount_total: 5700,
      currency: "usd",
      livemode: false,
      payment_intent: "pi",
    },
    "evt",
  );
  assert.equal(calls[0].args.subtotal, 5700);
}
(async () => {
  await run(false);
  await run(true);
  console.log(
    "PASS Gelato paid-only single submission, sandbox draft, timeout quarantine and verified payment subtotal",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
