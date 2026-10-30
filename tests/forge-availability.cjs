const ts = require("typescript"),
  fs = require("node:fs"),
  vm = require("node:vm"),
  assert = require("node:assert/strict");
async function check(ready, key = "sk_test_fixture", rpcError = false) {
  let handler;
  const db = {
    rpc: async (name) =>
      name === "foil_catalog"
        ? { data: [{ artworkId: 1, enabled: true }] }
        : { data: ready, error: rpcError ? Error("migration missing") : null },
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        then: (resolve) =>
          resolve({
            data: ["Standard", "Silver", "Gold", "Emerald", "Sapphire", "Prismatic"].map(
              (tier) => ({ tier, preview_path: "preview.webp", width: 4800, height: 4800 }),
            ),
          }),
      };
      return q;
    },
    storage: {
      from: () => ({
        getPublicUrl: () => ({ data: { publicUrl: "https://example.invalid/preview.webp" } }),
      }),
    },
  };
  const env = {
    STRIPE_SECRET_KEY: key,
    FOIL_CHECKOUT_ENABLED: "true",
    FORGE_PRINT_ENABLED: "true",
    FORGE_PRINT_CANVAS_ENABLED: "true",
    FORGE_PRINT_TAX_ENABLED: "true",
  };
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync("supabase/functions/forge-api/index.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports: {},
      require: () => ({
        service: () => db,
        printsEnabled: () => true,
        printMode: () => "sandbox",
        json: (data, status = 200) => Response.json(data, { status }),
        corsFor: () => ({}),
      }),
      Deno: { serve: (h) => (handler = h), env: { get: (name) => env[name] } },
      Request,
      Response,
      console,
    },
  );
  const response = await handler(
    new Request("https://example.invalid", {
      method: "POST",
      body: JSON.stringify({ action: "availability", artworkId: 1 }),
    }),
  );
  return response.json();
}
(async () => {
  assert.equal((await check(false)).canvasEnabled, false);
  assert.equal((await check(true)).canvasEnabled, true);
  assert.equal((await check(true, "sk_live_fixture")).canvasEnabled, false);
  assert.equal((await check(true, "sk_live_fixture")).paymentMode, "live");
  assert.equal((await check(true)).paymentMode, "test");
  assert.equal((await check(true, "sk_test_fixture", true)).canvasMappingsReady, false);
  console.log("PASS complete canvas mapping readiness and test/live environment visibility");
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
