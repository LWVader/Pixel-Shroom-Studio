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
  "202610190002_secondary_market.sql",
])
  await db.exec(await fs.readFile(`supabase/migrations/${file}`, "utf8"));
const a = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222",
  c = "33333333-3333-4333-8333-333333333333";
for (const id of [a, b, c]) await db.query("insert into auth.users values($1)", [id]);
await db.exec(
  `insert into artworks values(1,'Fantasy','published','master.png','Fixture','LWV-0000000001',15);insert into artwork_signatures values(1,'LWV-0000000001','image/png',repeat('a',64));select configure_foil_listing(1,true,1,0,0,0);`,
);
const primary = (await db.query("select reserve_foil_order(1,$1,repeat('b',64)) as p", [a])).rows[0]
  .p;
await db.query("update orders set provider_order_id='primary' where id=$1", [primary.orderId]);
await db.query(
  "select fulfill_stripe_checkout_verified('primary-paid','primary',$1,1500,'usd',null)",
  [primary.orderId],
);
await db.query(
  "update mints set state='ready',artifact_path='private/original-variant.webp',crypto_sha256=repeat('c',64) where id=$1",
  [primary.mintId],
);
for (const [id, account] of [
  [a, "acct_A"],
  [b, "acct_B"],
])
  await db.query("insert into market_sellers(user_id,stripe_account_id) values($1,$2)", [
    id,
    account,
  ]);
await assert.rejects(
  () => db.query("select create_market_listing($1,$2,5000)", [primary.mintId, b]),
  /unavailable/,
);
await assert.rejects(
  () => db.query("select create_market_listing($1,$2,5000)", [primary.mintId, a]),
  /onboarding/,
);
await db.exec(
  "update market_sellers set charges_enabled=true,payouts_enabled=true,transfers_enabled=true",
);
const list = (seller, cents = 5000) =>
  db
    .query("select create_market_listing($1,$2,$3) as id", [primary.mintId, seller, cents])
    .then((r) => r.rows[0].id);
const ready = async (id) => {
  const job = (await db.query("select claim_market_preview() as j")).rows[0].j;
  assert.equal(job.listingId, id);
  assert.equal(
    (
      await db.query("select finish_market_preview($1,$2,$3) as ok", [
        id,
        job.leaseId,
        `secondary/${id}/${job.leaseId}.webp`,
      ])
    ).rows[0].ok,
    true,
  );
};
const reserve = (offer, buyer) =>
  db.query("select reserve_market_checkout($1,$2) as p", [offer, buyer]).then((r) => r.rows[0].p);
const link = async (p) =>
  db.query("update market_purchases set checkout_session_id=$1 where id=$2", [
    "cs_" + p.purchaseId,
    p.purchaseId,
  ]);
const pay = (p, overrides = {}) =>
  db
    .query("select finalize_market_sale($1,$2,$3,$4,$5,$6,$7,$8) as r", [
      p.purchaseId,
      "cs_" + p.purchaseId,
      "pi_" + p.purchaseId,
      "paid_" + p.purchaseId,
      overrides.price ?? p.priceCents,
      overrides.currency ?? "usd",
      overrides.fee ?? p.feeCents,
      overrides.destination ?? p.destination,
    ])
    .then((r) => r.rows[0].r);
const owner = () =>
  db
    .query("select owner_id,ownership_version,market_frozen from mints where id=$1", [
      primary.mintId,
    ])
    .then((r) => r.rows[0]);
const first = await list(a);
await assert.rejects(() => list(a));
assert.deepEqual((await db.query("select market_feed() as feed")).rows[0].feed, []);
await ready(first);
const feed = (await db.query("select market_feed('Fixture','Standard',0) as feed")).rows[0].feed;
assert.equal(feed.length, 1);
assert.equal(JSON.stringify(feed).includes("private/"), false);
assert.equal(JSON.stringify(feed).includes(a), false);
await assert.rejects(() => reserve(first, a), /unavailable/);
const abandoned = await reserve(first, b);
await link(abandoned);
await assert.rejects(() => reserve(first, c), /unavailable/);
await assert.rejects(() => db.query("select cancel_market_listing($1,$2)", [first, a]), /reserved/);
await db.query("select expire_market_checkout($1,'wrong-session')", [abandoned.purchaseId]);
assert.equal(
  (await db.query("select status from secondary_market where id=$1", [first])).rows[0].status,
  "reserved",
);
await db.query("select expire_market_checkout($1,$2)", [
  abandoned.purchaseId,
  "cs_" + abandoned.purchaseId,
]);
const paid = await reserve(first, b);
await link(paid);
assert.equal(paid.feeCents, 500);
for (const invalid of [{ price: 1 }, { currency: "eur" }, { fee: 1 }, { destination: "acct_fake" }])
  await assert.rejects(() => pay(paid, invalid), /match/);
assert.equal((await owner()).owner_id, a);
assert.equal((await pay(paid)).transferred, true);
assert.equal((await pay(paid)).duplicate, true);
assert.equal((await owner()).owner_id, b);
assert.equal((await owner()).ownership_version, 1);
assert.notEqual(
  (await db.query("select access_token_hash from orders where id=$1", [primary.orderId])).rows[0]
    .access_token_hash,
  "b".repeat(64),
);
assert.equal((await db.query("select total_minted from foil_listings")).rows[0].total_minted, 1);
assert.equal((await db.query("select count(*)::int n from market_transfers")).rows[0].n, 1);
await assert.rejects(() => list(a), /unavailable/);
await db.query("select market_payment_problem($1,'refunded-first','full_refund',true)", [
  paid.purchaseId,
]);
assert.equal((await owner()).owner_id, a);
assert.equal((await owner()).ownership_version, 2);
assert.equal((await owner()).market_frozen, false);
const second = await list(a, 6000);
await ready(second);
const saleAB = await reserve(second, b);
await link(saleAB);
await pay(saleAB);
const third = await list(b, 7000);
await ready(third);
const saleBC = await reserve(third, c);
await link(saleBC);
await pay(saleBC);
assert.equal((await owner()).owner_id, c);
await db.query("select market_payment_problem($1,'refund-after-resale','full_refund',true)", [
  saleAB.purchaseId,
]);
assert.equal((await owner()).owner_id, c);
assert.equal((await owner()).market_frozen, true);
assert.equal(
  (await db.query("select state from market_purchases where id=$1", [saleAB.purchaseId])).rows[0]
    .state,
  "review",
);
await assert.rejects(() => list(c), /unavailable/);
await db.exec("set role anon");
await assert.rejects(() => db.query("select * from secondary_market"));
await assert.rejects(() => db.query("select market_feed()"));
await assert.rejects(() => db.query("select reserve_market_checkout($1,$2)", [third, a]));
await db.exec("reset role");
console.log(
  "PASS market ownership, listing uniqueness, reservations, fee/destination checks, replay, access revocation, refund rollback and resale-chain freeze",
);
await db.close();
