const fs = require("node:fs"),
  vm = require("node:vm"),
  ts = require("typescript"),
  assert = require("node:assert/strict");
const exportsObject = {};
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync("supabase/functions/_shared/market.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  {
    exports: exportsObject,
    require: () => ({}),
    Deno: { env: { get: () => null } },
    Date,
    console,
  },
);
async function run({ refund = false, dbError = false } = {}) {
  const calls = [],
    refunds = [];
  const db = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === "finalize_market_sale")
        return dbError
          ? { error: new Error("ambiguous transport failure") }
          : { data: refund ? { refundRequired: true } : { transferred: true } };
      return { data: {} };
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { id: "purchase", payment_intent_id: "pi_fixture", state: "refund_pending" },
          }),
        }),
      }),
      update: () => ({ eq: async () => ({}) }),
    }),
  };
  const intent = {
    id: "pi_fixture",
    status: "succeeded",
    amount_received: 5000,
    currency: "usd",
    metadata: { kind: "secondary", market_purchase_id: "purchase" },
    application_fee_amount: 500,
    transfer_data: { destination: "acct_seller" },
    latest_charge: "ch_fixture",
  };
  const stripe = {
    paymentIntents: { retrieve: async () => intent },
    charges: { retrieve: async () => ({ id: "ch_fixture", refunded: false }) },
    refunds: {
      create: async (args, options) => {
        refunds.push({ args, options });
        return { id: "re_fixture", status: "succeeded" };
      },
    },
  };
  const session = {
    id: "cs_fixture",
    payment_status: "paid",
    payment_intent: "pi_fixture",
    amount_total: 5000,
    metadata: { market_purchase_id: "purchase" },
  };
  if (dbError)
    await assert.rejects(
      () => exportsObject.completeMarketSession(db, stripe, session, "evt"),
      /ambiguous/,
    );
  else await exportsObject.completeMarketSession(db, stripe, session, "evt");
  if (refund) {
    assert.equal(refunds.length, 1);
    assert.equal(refunds[0].args.reverse_transfer, true);
    assert.equal(refunds[0].args.refund_application_fee, true);
    assert.equal(refunds[0].options.idempotencyKey, "market-full-refund-purchase");
    assert.equal(calls.at(-1).args.full_refund, true);
  } else assert.equal(refunds.length, 0);
  assert.equal(calls[0].args.destination, "acct_seller");
  assert.equal(calls[0].args.fee, 500);
  intent.amount_received = 1;
  await assert.rejects(
    () => exportsObject.completeMarketSession(db, stripe, session, "bad"),
    /mismatch/,
  );
}
(async () => {
  await run();
  await run({ refund: true });
  await run({ dbError: true });
  console.log(
    "PASS destination validation, gross commission, explicit reversal/refund and no refund on ambiguous database error",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
