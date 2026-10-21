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
const owner = "11111111-1111-4111-8111-111111111111";
await db.query("insert into auth.users values($1)", [owner]);
await db.exec(`insert into artworks values(1,'Fantasy','published','master.png','Fixture','LWV-0000000001',15);
insert into artwork_signatures values(1,'LWV-0000000001','image/png',repeat('a',64));
select configure_foil_listing_v2(1,true,500,100,50,30,15,5);`);
const reserve = async () =>
  (await db.query("select reserve_foil_order(1,$1,repeat('b',64)) p", [owner])).rows[0].p;
const legacy = await reserve();
await db.exec(
  await fs.readFile("supabase/migrations/202610190005_uploaded_tier_assets.sql", "utf8"),
);
assert.equal(
  (await db.query("select asset_mode from mints where id=$1", [legacy.mintId])).rows[0].asset_mode,
  "legacy",
);
await assert.rejects(reserve, /six finished/);
const tiers = ["Standard", "Silver", "Gold", "Emerald", "Sapphire", "Prismatic"];
const assets = tiers.map((tier, i) => ({
  tier,
  path: `foil-tiers/1/${tier.toLowerCase()}/11111111-1111-4111-8111-111111111111.png`,
  sha256: String(i + 1).repeat(64),
  mimeType: "image/png",
  width: 16,
  height: 16,
}));
for (const asset of assets)
  await db.query("insert into storage.objects values('originals',$1)", [asset.path]);
const setAssets = (list) =>
  db.query("select set_foil_tier_assets(1,$1::jsonb)", [JSON.stringify(list)]);
await setAssets(assets.slice(0, 5));
await db.exec("select configure_foil_listing_v2(1,true,500,100,50,30,15,5)");
assert.equal((await db.query("select foil_catalog() c")).rows[0].c[0].enabled, false);
await assert.rejects(reserve, /six finished/);
await assert.rejects(
  () => setAssets([{ ...assets[5], path: "public/unsafe.png" }]),
  /Private uploaded/,
);
await setAssets(assets.slice(5));
assert.equal((await db.query("select foil_catalog() c")).rows[0].c[0].enabled, true);
const publicCatalog = (await db.query("select foil_catalog() c")).rows[0].c;
assert.equal(publicCatalog[0].tierImages.length, 6);
assert.equal(JSON.stringify(publicCatalog).includes("foil-tiers/"), false);
const purchase = await reserve();
assert.equal(
  (await db.query("select asset_mode from mints where id=$1", [purchase.mintId])).rows[0]
    .asset_mode,
  "uploaded",
);
await assert.rejects(() => setAssets(assets), /locked/);
await db.query("update orders set provider_order_id='upload-test' where id=$1", [purchase.orderId]);
await db.query(
  "select fulfill_stripe_checkout_verified('paid-upload','upload-test',$1,1500,'usd',null)",
  [purchase.orderId],
);
const job = (await db.query("select claim_foil_job() j")).rows[0].j;
assert.equal(job.mint.tier, "Prismatic");
assert.equal(job.tier_asset.path, assets[5].path);
const path = `${owner}/${job.mint.id}/${job.mint.lease_id}.png`;
const receipt = {
  payload: {
    mintId: job.mint.id,
    sha256: assets[5].sha256,
    tier: "Prismatic",
    mimeType: "image/png",
  },
};
const finish = (hash, receiptValue = receipt) =>
  db.query("select finish_foil_job($1,$2,$3,$4,$5,16,16) done", [
    job.mint.id,
    job.mint.lease_id,
    path,
    hash,
    receiptValue,
  ]);
await assert.rejects(() => finish("f".repeat(64)), /Invalid artifact|mismatch/);
await assert.rejects(
  () => finish(assets[5].sha256, { payload: { ...receipt.payload, tier: "Gold" } }),
  /mismatch/,
);
assert.equal((await finish(assets[5].sha256)).rows[0].done, true);
assert.equal((await finish(assets[5].sha256)).rows[0].done, false);
await db.exec("set role anon");
await assert.rejects(() => db.query("select * from foil_tier_assets"), /permission denied/);
await assert.rejects(() => db.query("select set_foil_tier_assets(1,'[]')"), /permission denied/);
await assert.rejects(
  () => db.query("select reserve_foil_order_before_uploads(1,$1,repeat('b',64))", [owner]),
  /permission denied/,
);
await db.exec("reset role");
console.log(
  "PASS uploaded source readiness, immutable reservations, private mappings, selected tier copies and lease commits",
);
await db.close();
