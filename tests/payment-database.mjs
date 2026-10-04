// Run with an installed @electric-sql/pglite module (path may be supplied via PGLITE_MODULE).
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
await db.exec("create role anon; create role authenticated; create role service_role;");
// Fixtures mirror the uploaded master tables and do not depend on a live Supabase project.
await db.exec(`create table artworks(id bigint primary key, category text not null);
 create table orders(id uuid primary key,artwork_id bigint not null references artworks(id),provider text not null,provider_order_id text,status text not null default 'pending',amount numeric(10,2) not null,currency text not null default 'usd',buyer_email text,access_token_hash text,fulfillment_status text not null default 'pending',paid_at timestamptz);
 create table licenses(id uuid primary key default gen_random_uuid(),order_id uuid not null unique references orders(id),expires_at timestamptz not null,download_count integer not null default 0,download_limit integer not null default 3);
 create table webhook_events(provider text not null,event_id text not null,received_at timestamptz default now(),primary key(provider,event_id));`);
await db.exec(
  await fs.readFile(
    new URL(
      "../supabase/migrations/202610040001_payment_fulfillment_and_downloads.sql",
      import.meta.url,
    ),
    "utf8",
  ),
);
const ids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];
await db.exec(
  `insert into artworks values (1,'Fantasy');insert into orders(id,artwork_id,provider,provider_order_id,amount) values ('${ids[0]}',1,'stripe','cs_fixture',15),('${ids[1]}',1,'paypal','pp_fixture',15),('${ids[2]}',1,'stripe','cs_mismatch',15);`,
);
let r = await db.query(
  `select fulfill_stripe_checkout_verified('evt_one','cs_fixture',$1,1500,'usd','buyer@example.com') as result`,
  [ids[0]],
);
assert.equal(r.rows[0].result.fulfilled, true);
r = await db.query(`select status,buyer_email from orders where id=$1`, [ids[0]]);
assert.deepEqual(r.rows[0], { status: "paid", buyer_email: "buyer@example.com" });
const before = (await db.query("select expires_at from licenses where order_id=$1", [ids[0]]))
  .rows[0].expires_at;
r = await db.query(
  `select fulfill_stripe_checkout_verified('evt_one','cs_fixture',$1,1500,'usd',null) as result`,
  [ids[0]],
);
assert.equal(r.rows[0].result.duplicate, true);
await db.query(
  `select fulfill_stripe_checkout_verified('evt_two','cs_fixture',$1,1500,'usd',null)`,
  [ids[0]],
);
assert.equal(
  (
    await db.query("select expires_at from licenses where order_id=$1", [ids[0]])
  ).rows[0].expires_at.toISOString(),
  before.toISOString(),
);
await assert.rejects(() =>
  db.query(`select fulfill_stripe_checkout_verified('evt_bad','cs_mismatch',$1,1499,'usd',null)`, [
    ids[2],
  ]),
);
assert.equal(
  (await db.query("select count(*)::int as n from webhook_events where event_id='evt_bad'")).rows[0]
    .n,
  0,
);
for (let i = 0; i < 3; i++)
  assert.equal(
    (await db.query("select consume_verified_download($1) as allowed", [ids[0]])).rows[0].allowed,
    true,
  );
assert.equal(
  (await db.query("select consume_verified_download($1) as allowed", [ids[0]])).rows[0].allowed,
  false,
);
r = await db.query(
  `select fulfill_verified_order('paypal','pp_event','pp_fixture',$1,15,'USD',null) as result`,
  [ids[1]],
);
assert.equal(r.rows[0].result.fulfilled, true);
await db.query("update licenses set expires_at=now()-interval '1 second' where order_id=$1", [
  ids[1],
]);
assert.equal(
  (await db.query("select consume_verified_download($1) as allowed", [ids[1]])).rows[0].allowed,
  false,
);
await db.exec("set role anon");
await assert.rejects(() => db.query("select consume_verified_download($1)", [ids[0]]));
await db.exec("reset role");
console.log(
  "PASS: Stripe/PayPal fulfillment, duplicate events, no expiration reset, mismatched amount rollback, download limit, expiration, anonymous RPC rejection.",
);
await db.close();
