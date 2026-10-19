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
])
  await db.exec(await fs.readFile(`supabase/migrations/${file}`, "utf8"));
const owner = "11111111-1111-4111-8111-111111111111";
await db.query("insert into auth.users values ($1)", [owner]);
await db.exec(`insert into artworks values(1,'Fantasy','published','master.png','Fixture','LWV-0000000001',15),(2,'Fantasy','published','legacy.png','Legacy','LWV-0000000002',15);
insert into artwork_signatures values(1,'LWV-0000000001','image/png',repeat('a',64));
select configure_foil_listing(1,true,5,1,1,1);`);
const reserve = () =>
  db
    .query("select reserve_foil_order(1,$1,repeat('b',64)) as value", [owner])
    .then((r) => r.rows[0].value);
const orders = [];
for (let i = 0; i < 5; i++) orders.push(await reserve());
await assert.rejects(reserve, /slots/);
await assert.rejects(() => db.query("select configure_foil_listing(1,true,6,1,1,1)"), /locked/);
for (const [i, order] of orders.entries()) {
  await db.query("update orders set provider_order_id=$1 where id=$2", [`cs_${i}`, order.orderId]);
  await assert.rejects(
    () =>
      db.query("select fulfill_stripe_checkout_verified('bad',$1,$2,1,'usd',null)", [
        `cs_${i}`,
        order.orderId,
      ]),
    /mismatch/,
  );
  await db.query("select fulfill_stripe_checkout_verified($1,$2,$3,1500,'usd',null)", [
    `evt_${i}`,
    `cs_${i}`,
    order.orderId,
  ]);
  await db.query("select fulfill_stripe_checkout_verified($1,$2,$3,1500,'usd',null)", [
    `evt_${i}`,
    `cs_${i}`,
    order.orderId,
  ]);
}
assert.deepEqual(
  (await db.query("select tier from mints order by mint_number")).rows.map((r) => r.tier),
  ["Prismatic", "Gold", "Silver", "Standard", "Standard"],
);
assert.equal((await db.query("select total_minted from foil_listings")).rows[0].total_minted, 5);
assert.equal((await db.query("select count(*)::int n from licenses")).rows[0].n, 0);
const catalog = (await db.query("select foil_catalog() as c")).rows[0].c;
assert.equal(catalog[0].prismaticsRemaining, 0);
assert.equal(JSON.stringify(catalog).includes("master.png"), false);
let job = (await db.query("select claim_foil_job() as j")).rows[0].j;
const allocation = job.mint.mint_number;
await db.query("select fail_foil_job($1,$2)", [job.mint.id, job.mint.lease_id]);
await db.exec("update mints set available_at=now()-interval '1 second'");
job = (await db.query("select claim_foil_job() as j")).rows[0].j;
assert.equal(job.mint.mint_number, allocation);
const artifact = `${owner}/${job.mint.id}/${job.mint.lease_id}.webp`;
const finish = (lease) =>
  db.query("select finish_foil_job($1,$2,$3,repeat('c',64),$4,512,512) as done", [
    job.mint.id,
    lease,
    artifact,
    { payload: { sha256: "c".repeat(64), mintId: job.mint.id } },
  ]);
assert.equal((await finish("22222222-2222-4222-8222-222222222222")).rows[0].done, false);
assert.equal((await finish(job.mint.lease_id)).rows[0].done, true);
assert.equal((await finish(job.mint.lease_id)).rows[0].done, false);
await db.query("select release_foil_order($1,'cs_0')", [orders[0].orderId]);
assert.equal(
  (await db.query("select status from orders where id=$1", [orders[0].orderId])).rows[0].status,
  "paid",
);
await db.exec(
  "insert into orders(artwork_id,provider,provider_order_id,amount,access_token_hash) values(2,'stripe','cs_legacy',15,repeat('b',64));",
);
const legacy = (await db.query("select id from orders where provider_order_id='cs_legacy'")).rows[0]
  .id;
await db.query(
  "select fulfill_stripe_checkout_verified('evt_legacy','cs_legacy',$1,1500,'usd',null)",
  [legacy],
);
assert.equal(
  (await db.query("select count(*)::int n from licenses where order_id=$1", [legacy])).rows[0].n,
  1,
);

await db.exec(`insert into artworks values(3,'Fantasy','published','third.png','Expiry','LWV-0000000003',15);
insert into artwork_signatures values(3,'LWV-0000000003','image/png',repeat('a',64));
select configure_foil_listing(3,true,1,0,0,0);`);
const expiring = (
  await db.query("select reserve_foil_order(3,$1,repeat('b',64)) as value", [owner])
).rows[0].value;
await db.query("update orders set provider_order_id='cs_expire' where id=$1", [expiring.orderId]);
await db.query("select release_foil_order($1,'wrong-session')", [expiring.orderId]);
assert.equal(
  (await db.query("select state from mints where order_id=$1", [expiring.orderId])).rows[0].state,
  "reserved",
);
await db.query("select release_foil_order($1,'cs_expire')", [expiring.orderId]);
assert.equal(
  (await db.query("select state from mints where order_id=$1", [expiring.orderId])).rows[0].state,
  "released",
);
await db.query("select reserve_foil_order(3,$1,repeat('b',64))", [owner]);
await assert.rejects(
  () =>
    db.query(
      "select fulfill_stripe_checkout_verified('expired-paid','cs_expire',$1,1500,'usd',null)",
      [expiring.orderId],
    ),
  /mismatch/,
);
await db.exec("set role anon");
await assert.rejects(() => db.query("select * from mints"));
await assert.rejects(() => db.query("select claim_foil_job()"));
await assert.rejects(() => db.query("select reserve_foil_order(1,$1,repeat('b',64))", [owner]));
await db.exec("reset role");
console.log(
  "PASS mint caps, supply, paid allocation, replay, lease fencing, no original license, private tables, legacy digital delivery",
);
await db.close();
