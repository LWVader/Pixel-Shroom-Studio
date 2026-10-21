const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
function load(file, { db, stripe = {}, authenticated = true, enabled = true } = {}) {
  let handler;
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports: {},
      require: (name) =>
        name.includes("common")
          ? {
              service: () => db,
              corsFor: () => ({}),
              studioSiteUrl: () => "https://www.pixelshroomstudio.com",
              json: (body, status = 200) => new Response(JSON.stringify(body), { status }),
            }
          : {
              marketStripe: () => stripe,
              syncMarketSeller: async () => ({ charges_enabled: true }),
              refundMarketPurchase: () => {
                throw Error("unauthorized refund");
              },
            },
      Deno: {
        serve: (fn) => {
          handler = fn;
        },
        env: {
          get: (key) =>
            key === "MARKETPLACE_ENABLED"
              ? String(enabled)
              : key === "SUPABASE_SERVICE_ROLE_KEY"
                ? "service-secret"
                : "",
        },
      },
      Response,
      Request,
      Date,
      console,
    },
  );
  return (body, token = authenticated ? "user-token" : "") =>
    handler(
      new Request("https://fixture/api", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }),
    );
}
(async () => {
  const calls = [];
  let checkout;
  const db = {
    auth: {
      getUser: async (token) => ({
        data: {
          user: token === "user-token" ? { id: "real-buyer", email: "fixture@example.test" } : null,
        },
      }),
    },
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === "market_feed") return { data: [] };
      return {
        data: {
          purchaseId: "reserved-purchase",
          priceCents: 5000,
          feeCents: 500,
          destination: "acct_real_seller",
          tier: "Gold",
          mintNumber: 42,
        },
      };
    },
    from: (table) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () => ({ data: { seller_id: "real-seller" } }),
        maybeSingle: async () => ({ data: null }),
        update: () => ({ eq: async () => ({}) }),
      };
      return chain;
    },
  };
  const api = load("supabase/functions/market-api/index.ts", {
    db,
    stripe: {
      checkout: {
        sessions: {
          create: async (args) => {
            checkout = args;
            return { id: "cs_fixture", url: "https://checkout.stripe.com/fixture" };
          },
        },
      },
    },
  });
  assert.equal(
    (
      await api({
        action: "checkout",
        listingId: "offer",
        buyerId: "forged",
        priceCents: 1,
        feeCents: 0,
        destination: "acct_attacker",
      })
    ).status,
    201,
  );
  assert.equal(calls[0].args.buyer, "real-buyer");
  assert.equal(checkout.line_items[0].price_data.unit_amount, 5000);
  assert.equal(checkout.payment_intent_data.application_fee_amount, 500);
  assert.equal(checkout.payment_intent_data.transfer_data.destination, "acct_real_seller");
  assert.equal((await api({ action: "refund", purchaseId: "someone-elses" })).status, 403);
  assert.equal((await api({ action: "checkout" }, "invalid")).status, 401);
  for (const tier of ["Emerald", "Sapphire"]) {
    assert.equal((await api({ action: "feed", tier })).status, 200);
    assert.equal(calls.at(-1).args.tier_filter, tier);
  }
  const disabled = load("supabase/functions/market-api/index.ts", { db, enabled: false });
  assert.equal((await disabled({ action: "checkout" })).status, 503);
  assert.equal((await (await disabled({ action: "feed" })).json()).enabled, false);
  const reconcile = load("supabase/functions/market-reconcile/index.ts", { db });
  assert.equal((await reconcile({}, "user-token")).status, 403);
  console.log("PASS marketplace endpoint authorization and authoritative checkout snapshots");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
