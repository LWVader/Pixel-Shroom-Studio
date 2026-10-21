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
const owner = "11111111-1111-4111-8111-111111111111";
await db.query("insert into auth.users values($1)", [owner]);
await assert.rejects(
  () =>
    db.exec(
      "insert into artworks(id,category,status,original_path,title,serial_number,price,requires_tier_images) values(1,'Fantasy','published','master.png','Fixture','LWV-0000000001',15,true)",
    ),
  /six tier images/,
);
await db.exec(
  "insert into artworks(id,category,status,original_path,title,serial_number,price) values(1,'Fantasy','draft','master.png','Fixture','LWV-0000000001',15);insert into artwork_signatures values(1,'LWV-0000000001','image/png',repeat('a',64));select configure_foil_listing_v2(1,true,8,1,1,1,1,1)",
);
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
await db.query("select set_foil_tier_assets(1,$1)", [JSON.stringify(assets.slice(0, 5))]);
await assert.rejects(
  () => db.exec("update artworks set status='published' where id=1"),
  /six tier images/,
);
await db.query("select set_foil_tier_assets(1,$1)", [JSON.stringify(assets.slice(5))]);
await db.exec("update artworks set status='published' where id=1");
const reserve = async () =>
  (await db.query("select reserve_foil_order(1,$1,repeat('b',64)) p", [owner])).rows[0].p;
await assert.rejects(reserve, /hashes are still/);
assert.equal((await db.query("select count(*)::int n from foil_copy_inventory")).rows[0].n, 13);
for (;;) {
  const batch = (await db.query("select claim_foil_copy_batch() j")).rows[0].j;
  if (!batch) break;
  for (const copy of batch.copies) {
    // Fixture hashes; production computes each actual metadata-bearing file.
    const hash = copy.id.replaceAll("-", "").padEnd(64, "0");
    assert.equal(
      (await db.query("select finish_foil_copy($1,$2,$3) ok", [copy.id, copy.lease_id, hash]))
        .rows[0].ok,
      true,
    );
    assert.equal(
      (await db.query("select finish_foil_copy($1,$2,$3) ok", [copy.id, copy.lease_id, hash]))
        .rows[0].ok,
      false,
    );
  }
}
assert.equal((await db.query("select foil_inventory_ready(1) ok")).rows[0].ok, true);
const purchase = await reserve();
await assert.rejects(
  () => db.query("select set_foil_tier_assets(1,$1)", [JSON.stringify(assets)]),
  /locked/,
);
await db.query("update orders set provider_order_id='copy-paid' where id=$1", [purchase.orderId]);
await db.query(
  "select fulfill_stripe_checkout_verified('copy-event','copy-paid',$1,1500,'usd',null)",
  [purchase.orderId],
);
const mint = (await db.query("select * from mints where id=$1", [purchase.mintId])).rows[0];
assert.equal(mint.tier, "Prismatic");
assert.ok(mint.copy_id);
await db.query(
  "select fulfill_stripe_checkout_verified('copy-event','copy-paid',$1,1500,'usd',null)",
  [purchase.orderId],
);
assert.equal(
  (await db.query("select count(*)::int n from foil_copy_inventory where state='assigned'")).rows[0]
    .n,
  1,
);
const job = (await db.query("select claim_foil_job() j")).rows[0].j;
assert.equal(job.copy.id, mint.copy_id);
assert.equal(job.tier_asset.tier, "Prismatic");
const receipt = {
  payload: {
    mintId: mint.id,
    copyId: job.copy.id,
    tier: mint.tier,
    sha256: job.copy.sha256,
    mimeType: "image/png",
  },
};
const finish = () =>
  db.query("select finish_foil_job($1,$2,$3,$4,$5,16,16) ok", [
    mint.id,
    job.mint.lease_id,
    `${owner}/${mint.id}/${job.mint.lease_id}.png`,
    job.copy.sha256,
    receipt,
  ]);
assert.equal((await finish()).rows[0].ok, true);
assert.equal((await finish()).rows[0].ok, false);
await db.exec("set role anon");
await assert.rejects(() => db.exec("select * from foil_copy_inventory"), /permission denied/);
await assert.rejects(() => db.exec("select claim_foil_copy_batch()"), /permission denied/);
await db.exec("reset role");
console.log(
  "PASS private copy inventory, prepayment hashes, immutable source, paid assignment, replay and publish gate",
);
await db.close();
