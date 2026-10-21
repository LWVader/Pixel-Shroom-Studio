const fs = require("node:fs"),
  vm = require("node:vm"),
  assert = require("node:assert/strict"),
  ts = require("typescript");
const source = ts.transpileModule(
  fs.readFileSync("supabase/functions/stripe-webhook/index.ts", "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
).outputText;
async function scenario({
  fail = false,
  duplicate = false,
  kind = "foil",
  url = "https://workspace--wake.modal.run/wake",
} = {}) {
  let handler;
  const calls = [];
  let fulfilled = 0;
  class Stripe {
    constructor() {
      this.webhooks = {
        constructEventAsync: async (raw) => {
          assert.equal(raw, "raw-fixture");
          return {
            id: "evt_fixture",
            type: "checkout.session.completed",
            data: {
              object: {
                id: "cs_fixture",
                payment_status: "paid",
                amount_total: 1500,
                currency: "usd",
                metadata: { order_id: "fixture", kind },
              },
            },
          };
        },
      };
    }
  }
  const common = {
    json: (body, status = 200) => new Response(JSON.stringify(body), { status }),
    service: () => ({
      rpc: async (name) => {
        assert.equal(name, "fulfill_stripe_checkout_verified");
        fulfilled++;
        return { data: { fulfilled: !duplicate, duplicate } };
      },
    }),
  };
  vm.runInNewContext(source, {
    exports: {},
    require: (name) =>
      name.startsWith("npm:stripe") ? { __esModule: true, default: Stripe } : common,
    Deno: {
      env: {
        get: (name) =>
          ({
            STRIPE_SECRET_KEY: "fixture-key",
            STRIPE_WEBHOOK_SECRET: "fixture-webhook",
            MODAL_MINT_WAKE_URL: url,
            MODAL_MINT_WAKE_TOKEN: "fixture-wake-token",
          })[name],
      },
      serve: (h) => (handler = h),
    },
    Request,
    Response,
    URL,
    AbortSignal,
    console: { error() {}, warn() {} },
    fetch: async (endpoint, options) => {
      calls.push({ endpoint: String(endpoint), options });
      if (fail) throw new Error("unavailable");
      return new Response("{}", { status: 202 });
    },
  });
  const response = await handler(
    new Request("https://fixture", {
      method: "POST",
      headers: { "stripe-signature": "fixture" },
      body: "raw-fixture",
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(fulfilled, 1);
  return calls;
}
(async () => {
  let calls = await scenario();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.Authorization, "Bearer fixture-wake-token");
  assert.equal(calls[0].options.redirect, "error");
  calls = await scenario({ fail: true });
  assert.equal(calls.length, 1);
  assert.equal((await scenario({ duplicate: true })).length, 0);
  assert.equal((await scenario({ kind: "digital" })).length, 0);
  assert.equal((await scenario({ url: "https://evil.example/wake" })).length, 0);
  console.log(
    "PASS Modal wake after fulfillment, outage isolation, no duplicate/digital wake, endpoint validation",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
