const ts = require(process.env.TYPESCRIPT_MODULE || "typescript");
const vm = require("node:vm"),
  fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, "../supabase/functions");
function transpile(file) {
  const result = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
  });
  assert.equal(
    result.diagnostics?.filter((x) => x.category === ts.DiagnosticCategory.Error).length,
    0,
    file,
  );
  return result.outputText;
}
let moduleCommon = { exports: {} };
vm.runInNewContext(transpile(path.join(root, "_shared/common.ts")), {
  exports: moduleCommon.exports,
  require: () => ({ createClient: () => ({}) }),
  Deno: {
    env: {
      get: (name) =>
        name === "SITE_URL" ? "https://pixel-shroom-studio.phantasmocazdor.workers.dev" : undefined,
    },
  },
  URL,
  Request,
  Response,
  TextEncoder,
  Uint8Array,
  crypto: globalThis.crypto,
  console,
});
const common = moduleCommon.exports;
assert.equal(common.studioSiteUrl(), "https://www.pixelshroomstudio.com");
for (const origin of ["https://www.pixelshroomstudio.com", "https://pixelshroomstudio.com"])
  assert.equal(
    common.corsFor(new Request(origin, { headers: { Origin: origin } }))[
      "Access-Control-Allow-Origin"
    ],
    origin,
  );
assert.notEqual(
  common.corsFor(
    new Request("https://evil.invalid", { headers: { Origin: "https://evil.invalid" } }),
  )["Access-Control-Allow-Origin"],
  "https://evil.invalid",
);
function loadHandler(name, dependencies) {
  let handler;
  vm.runInNewContext(transpile(path.join(root, name, "index.ts")), {
    exports: {},
    require: () => dependencies,
    Deno: { serve: (h) => (handler = h), env: { get: () => undefined } },
    URL,
    Request,
    Response,
    TextEncoder,
    crypto: globalThis.crypto,
    console,
  });
  return handler;
}
const requests = [],
  db = {
    from: () => ({
      select: () => ({
        eq() {
          return this;
        },
        single: async () => ({
          data: {
            id: "order",
            status: "pending",
            access_token_hash: "match",
            artworks: { category: "Fantasy", title: "Test", serial_number: "LWV-1234" },
            licenses: null,
          },
        }),
      }),
    }),
  };
(async () => {
  const handler = loadHandler("order-status", {
    ...common,
    service: () => db,
    sha256: async () => "match",
  });
  let r = await handler(
    new Request("https://test", {
      method: "OPTIONS",
      headers: { Origin: "https://www.pixelshroomstudio.com" },
    }),
  );
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://www.pixelshroomstudio.com");
  r = await handler(
    new Request("https://test", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://pixelshroomstudio.com" },
      body: JSON.stringify({ orderId: "order", accessToken: "token" }),
    }),
  );
  assert.equal(r.status, 200);
  assert.equal((await r.json()).downloadUrl, null);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://pixelshroomstudio.com");
  r = await handler(new Request("https://test", { method: "GET" }));
  assert.equal(r.status, 405);
  r = await handler(new Request("https://test", { method: "POST", body: "{}" }));
  assert.equal(r.status, 400);
  console.log(
    "PASS: TypeScript parsing, canonical return domain, www/apex CORS, foreign-origin rejection, pending order never gets a download, missing credentials, invalid methods.",
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
