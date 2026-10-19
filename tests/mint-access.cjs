const ts = require("typescript"),
  vm = require("node:vm"),
  fs = require("node:fs"),
  assert = require("node:assert/strict");
const minted = [
  {
    id: "mint-a",
    collection_added_at: "2026-10-19",
    order_id: "order-a",
    owner_id: "owner-a",
    state: "ready",
    artifact_path: "owner-a/mint-a/lease.webp",
    manifest: { signature: "fixture" },
    tier: "Gold",
    mint_number: 1,
    width: 128,
    height: 96,
    foil_listings: { master_title: "A", max_supply: 500 },
  },
  {
    id: "mint-b",
    order_id: "order-b",
    owner_id: "owner-b",
    state: "ready",
    artifact_path: "owner-b/mint-b/lease.webp",
    manifest: {},
    foil_listings: { master_title: "B" },
  },
];
const orders = [
  { id: "order-a", status: "paid", sale_kind: "foil", access_token_hash: "hash-secret-a" },
  { id: "order-b", status: "paid", sale_kind: "foil", access_token_hash: "hash-secret-b" },
];
let urls = [];
const db = {
  auth: {
    getUser: async (token) => ({
      data: { user: token === "owner-a-token" ? { id: "owner-a" } : null },
    }),
  },
  storage: {
    from: (bucket) => ({
      createSignedUrl: async (path) => {
        assert.equal(bucket, "minted");
        urls.push(path);
        return {
          data: { signedUrl: `https://fixture.supabase.co/storage/v1/object/sign/minted/${path}` },
        };
      },
    }),
  },
  rpc: async (name, fields) => {
    assert.equal(name, "add_mint_to_collection");
    assert.equal(fields.holder, "owner-a");
    return { data: true };
  },
  from: (table) => {
    let filters = [];
    const source = table === "mints" ? minted : orders;
    const query = {
      select() {
        return this;
      },
      eq(key, value) {
        filters.push([key, value]);
        return this;
      },
      not(key) {
        filters.push([key, "NOT_NULL"]);
        return this;
      },
      is(key) {
        filters.push([key, null]);
        return this;
      },
      order() {
        return this;
      },
      range() {
        return Promise.resolve({
          data: source.filter((row) =>
            filters.every(([k, v]) => (v === "NOT_NULL" ? row[k] != null : row[k] === v)),
          ),
        });
      },
      single() {
        return Promise.resolve({
          data: source.find((row) =>
            filters.every(([k, v]) => (v === "NOT_NULL" ? row[k] != null : row[k] === v)),
          ),
        });
      },
    };
    return query;
  },
};
let handler;
const code = ts.transpileModule(
  fs.readFileSync("supabase/functions/mint-access/index.ts", "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
vm.runInNewContext(code, {
  exports: {},
  require: () => ({
    service: () => db,
    sha256: async (text) => "hash-" + text,
    corsFor: () => ({}),
    json: (body, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  }),
  Deno: { serve: (h) => (handler = h) },
  Request,
  Response,
  console,
  Array,
  String,
  Number,
  Math,
});
async function call(body, token = "") {
  return handler(
    new Request("https://fixture", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify(body),
    }),
  );
}
(async () => {
  assert.equal((await call({ action: "collection" })).status, 401);
  let response = await call({ action: "collection" }, "owner-a-token");
  let result = await response.json();
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, "mint-a");
  assert.equal(urls[0], minted[0].artifact_path);
  response = await call({ action: "download", mintId: "mint-b" }, "owner-a-token");
  assert.deepEqual((await response.json()).items, []);
  assert.equal(
    (await call({ action: "status", orderId: "order-b", accessToken: "wrong" })).status,
    403,
  );
  response = await call({
    action: "download",
    orderId: "order-b",
    accessToken: "secret-b",
    mintId: "mint-b",
  });
  assert.equal((await response.json()).items[0].id, "mint-b");
  orders[0].status = "refunded";
  response = await call({ action: "collection" }, "owner-a-token");
  assert.equal((await response.json()).items[0].imageUrl, null);
  orders[0].status = "paid";
  minted[0].state = "queued";
  response = await call({ action: "download", mintId: "mint-a" }, "owner-a-token");
  assert.equal((await response.json()).items[0].imageUrl, null);
  assert.equal((await call({ action: "download" }, "owner-a-token")).status, 400);
  minted[0].state = "ready";
  minted[0].ownership_version = 1;
  response = await call({ action: "status", orderId: "order-a", accessToken: "secret-a" });
  assert.deepEqual((await response.json()).items, []);
  minted[0].market_frozen = true;
  response = await call({ action: "collection" }, "owner-a-token");
  assert.equal((await response.json()).items[0].imageUrl, null);
  assert.equal((await call({ action: "add_to_collection", mintId: "mint-a" })).status, 401);
  const added = await call(
    { action: "add_to_collection", mintId: "mint-a", holder: "owner-b" },
    "owner-a-token",
  );
  assert.equal((await added.json()).added, true);
  minted[0].collection_added_at = null;
  response = await call({ action: "collection" }, "owner-a-token");
  assert.equal((await response.json()).items.length, 0);
  response = await call({ action: "uncollected" }, "owner-a-token");
  result = await response.json();
  assert.equal(result.items[0].imageUrl, null);
  assert.equal(result.items[0].paymentConfirmed, true);
  console.log(
    "PASS private ownership, order-token isolation, refund/queued blocking, minted-only storage",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
