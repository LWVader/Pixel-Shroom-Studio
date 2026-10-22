import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;
create table auth.users(id uuid primary key);
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create function is_admin() returns boolean language sql as $$select true$$;
-- Deterministic fixture only. Production uses pgcrypto secure rejection sampling.
create function gen_random_bytes(integer) returns bytea language sql as $$select decode('00','hex')$$;
create table artworks(id bigint primary key,category text,status text,original_path text,title text,serial_number text,price numeric(10,2));
create table artwork_signatures(artwork_id bigint primary key,serial_number text,mime_type text,sha256 text);
create table orders(id uuid primary key default gen_random_uuid(),artwork_id bigint references artworks(id),provider text,provider_order_id text,status text default 'pending',amount numeric(10,2),currency text default 'usd',buyer_email text,access_token_hash text,fulfillment_status text default 'pending',paid_at timestamptz,created_at timestamptz default now());
create table licenses(id uuid primary key default gen_random_uuid(),order_id uuid unique references orders(id),expires_at timestamptz,download_count integer default 0,download_limit integer default 3);
create table webhook_events(provider text,event_id text,received_at timestamptz default now(),primary key(provider,event_id));`);
for (const file of [
  "202610040001_payment_fulfillment_and_downloads.sql",
  "202610190001_foil_mint_engine.sql",
  "202610190003_six_foil_tiers.sql",
  "202610190002_secondary_market.sql",
  "202610190004_post_reveal_collection.sql",
])
  await db.exec(await fs.readFile(`supabase/migrations/${file}`, "utf8"));

await db.exec(
  "create table storage.objects(bucket_id text,name text,primary key(bucket_id,name));",
);

await db.exec(
  await fs.readFile("supabase/migrations/202610190005_uploaded_tier_assets.sql", "utf8"),
);
await db.exec(
  await fs.readFile("supabase/migrations/202610190006_prehashed_copy_inventory.sql", "utf8"),
);
await db.exec(
  await fs.readFile("supabase/migrations/202610210002_gelato_print_orders.sql", "utf8"),
);
await db.exec(await fs.readFile("supabase/migrations/202610220002_forge_print_loop.sql", "utf8"));
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
await db.query("insert into auth.users values($1),($2)", [owner, other]);
await db.exec(
  "insert into artworks(id,category,status,original_path,title,serial_number,price) values(1,'Fantasy','draft','master.png','Fixture','LWV-0000000001',15);insert into artwork_signatures values(1,'LWV-0000000001','image/png',repeat('a',64));select configure_foil_listing_v2(1,true,100,20,10,6,3,1)",
);
const tiers = ["Standard", "Silver", "Gold", "Emerald", "Sapphire", "Prismatic"];
for (const [i, tier] of tiers.entries()) {
  const path = `foil-tiers/1/${tier.toLowerCase()}/${owner}.png`;
  await db.query("insert into storage.objects values('originals',$1)", [path]);
  await db.query("select set_foil_tier_assets(1,$1)", [
    JSON.stringify([
      {
        tier,
        path,
        sha256: String(i + 1).repeat(64),
        mimeType: "image/png",
        width: 4800,
        height: 4800,
      },
    ]),
  ]);
  const preview = `foil-tiers/1/${tier.toLowerCase()}/${owner}.webp`;
  await db.query("insert into storage.objects values('previews',$1)", [preview]);
  await db.query("select set_foil_tier_preview(1,$1,$2)", [tier, preview]);
}
await db.exec(
  "update artworks set status='published';update foil_copy_inventory set state='ready',sha256=replace(id::text,'-','')||repeat('0',32)",
);
await db.exec(
  "create or replace function gen_random_bytes(integer) returns bytea language sql as $$select decode('63','hex')$$",
);
let seq = 0;
async function paid(offer = "digital") {
  const p = (
    await db.query("select reserve_forge_print_order(1,$1,repeat('b',64),$2,true) p", [
      owner,
      offer,
    ])
  ).rows[0].p;
  const id = "session_" + ++seq;
  await db.query("update orders set provider_order_id=$1 where id=$2", [id, p.orderId]);
  await assert.rejects(
    () =>
      db.query("select fulfill_stripe_checkout_verified($1,$2,$3,1,'usd',null)", [
        "bad_" + seq,
        id,
        p.orderId,
      ]),
    /mismatch/,
  );
  await db.query("select fulfill_stripe_checkout_verified($1,$2,$3,$4,'usd',null)", [
    "evt_" + seq,
    id,
    p.orderId,
    Math.round(p.price * 100),
  ]);
  await db.query(
    "update mints set state='ready',artifact_path='fixture.png',width=4800,height=4800 where id=$1",
    [p.mintId],
  );
  return p;
}
const inputs = [];
for (let i = 0; i < 5; i++) inputs.push((await paid()).mintId);
assert.ok(
  (await db.query("select collection_added_at from mints where id=$1", [inputs[0]])).rows[0]
    .collection_added_at,
);
const op = "33333333-3333-4333-8333-333333333333";
const forge = async (holder = owner, ids = inputs, key = op) =>
  (await db.query("select forge_edition($1,$2,$3) r", [holder, ids, key])).rows[0].r;
await assert.rejects(() => forge(other), /unavailable/);
await assert.rejects(() => forge(owner, [inputs[0], inputs[0], ...inputs.slice(2)]), /distinct/);
const output = await forge();
assert.equal(output.tier, "Silver");
assert.equal((await forge()).mintId, output.mintId);
assert.equal((await db.query("select count(*)::int n from forge_inputs")).rows[0].n, 5);
assert.equal(
  (await db.query("select count(*)::int n from mints where forge_consumed_at is not null")).rows[0]
    .n,
  5,
);
await assert.rejects(
  () => forge(owner, inputs, "44444444-4444-4444-8444-444444444444"),
  /unavailable/,
);
assert.equal(
  (
    await db.query("select count(*)::int n from foil_copy_inventory where mint_id=$1", [
      output.mintId,
    ])
  ).rows[0].n,
  1,
);
const more = [];
for (let i = 0; i < 5; i++) more.push((await paid()).mintId);
await db.exec(
  "alter table foil_listings disable trigger queue_config_copies;update foil_listings set silver_cap=1",
);
await assert.rejects(() => forge(owner, more, "55555555-5555-4555-8555-555555555555"), /inventory/);
assert.equal(
  (
    await db.query(
      "select count(*)::int n from mints where id=any($1) and forge_consumed_at is not null",
      [more],
    )
  ).rows[0].n,
  0,
);
await db.exec(
  "update foil_listings set silver_cap=20;alter table foil_listings enable trigger queue_config_copies",
);
await assert.rejects(() => paid("canvas"), /six approved/);
const productIds = [];
for (const [i, tier] of tiers.entries()) {
  const id = `aaaaaaaa-aaaa-4aaa-8aaa-${String(i + 1).padStart(12, "0")}`;
  productIds.push(id);
  await db.query(
    "insert into gelato_products(id,title,kind,variant_label,product_uid,preview_url,print_path,stripe_tax_code,retail_cents,active,print_ready,edition_artwork_id,edition_tier) values($1,'Canvas','canvas',$2,'product-uid','https://example.com/p.webp','gelato/file.png','txcd_99999999',4900,true,true,1,$2)",
    [id, tier],
  );
}
const canvas = await paid("canvas");
assert.equal(
  (await db.query("select state from canvas_claims where mint_id=$1", [canvas.mintId])).rows[0]
    .state,
  "available",
);
await assert.rejects(
  () => forge(owner, [canvas.mintId, ...more.slice(1)], "66666666-6666-4666-8666-666666666666"),
  /canvas claim/,
);
async function quote(mint = canvas.mintId) {
  const q = crypto.randomUUID();
  await db.query(
    `insert into gelato_quotes(id,owner_id,product_id,product_snapshot,quantity,recipient,test_mode,state,shipping_options,edition_mint_id) values($1,$2,$3,$4,1,'{}',true,'ready','[{"uid":"standard","cents":0}]',$5)`,
    [q, owner, productIds[0], { id: productIds[0], retail_cents: 0, claimMintId: mint }, mint],
  );
  return (await db.query("select reserve_gelato_checkout($1,$2,'standard') o", [q, owner])).rows[0]
    .o;
}
await assert.rejects(
  () =>
    db.query("update gelato_products set product_uid='wrong-frame' where id=$1", [productIds[0]]),
  /reserved/,
);
const order = await quote();
await assert.rejects(
  () => db.query("select redeem_canvas_claim($1,$2)", [order.id, other]),
  /Invalid/,
);
await db.query("select redeem_canvas_claim($1,$2)", [order.id, owner]);
await db.query("select redeem_canvas_claim($1,$2)", [order.id, owner]);
assert.equal(
  (await db.query("select state from canvas_claims where mint_id=$1", [canvas.mintId])).rows[0]
    .state,
  "redeemed",
);
assert.equal(
  (await db.query("select payment_state from gelato_orders where id=$1", [order.id])).rows[0]
    .payment_state,
  "paid",
);
const second = await quote();
await assert.rejects(
  () => db.query("select redeem_canvas_claim($1,$2)", [second.id, owner]),
  /unavailable/,
);
await assert.rejects(
  () => db.query("update mints set owner_id=$1 where id=$2", [other, canvas.mintId]),
  /print order/,
);
await db.query("select hold_forge_print_purchase($1)", [
  (await db.query("select order_id from mints where id=$1", [inputs[0]])).rows[0].order_id,
]);
assert.equal(
  (await db.query("select market_frozen from mints where id=$1", [output.mintId])).rows[0]
    .market_frozen,
  true,
);
await db.exec("set role anon");
await assert.rejects(
  () => db.query("select forge_edition($1,$2,$3)", [owner, more, crypto.randomUUID()]),
  /permission/,
);
await assert.rejects(() => db.query("select * from canvas_claims"), /permission/);
await db.exec("reset role");
console.log(
  "PASS Forge replay, caps, consumed-input privacy, ownership, canvas claims, exact-once redemption and reversal lineage",
);
await db.close();
