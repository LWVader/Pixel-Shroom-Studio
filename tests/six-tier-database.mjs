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
await db.query("insert into auth.users values($1)", [owner]);
for (const id of [1, 2, 3]) {
  await db.query(
    "insert into artworks values($1,'Fantasy','published','master.png','Fixture','LWV-'||lpad(($1::bigint)::text,10,'0'),15)",
    [id],
  );
  await db.query(
    "insert into artwork_signatures values($1,'LWV-'||lpad(($1::bigint)::text,10,'0'),'image/png',repeat('a',64))",
    [id],
  );
}
await db.exec("select configure_foil_listing(1,true,500,100,45,5)");
const reserve = async (id) =>
  (await db.query("select reserve_foil_order($1,$2,repeat('b',64)) as value", [id, owner])).rows[0]
    .value;
const legacy = await reserve(1);
await db.exec(await fs.readFile("supabase/migrations/202610190003_six_foil_tiers.sql", "utf8"));
let settings = (await db.query("select admin_foil_settings(1) as s")).rows[0].s;
assert.equal(settings.rulesVersion, 1);
assert.equal(settings.dropRates.Gold, 9);
assert.equal(settings.emeraldCap, 0);
assert.equal(settings.locked, true);
await assert.rejects(
  () => db.exec("select configure_foil_listing_v2(1,true,500,100,45,1,0,5)"),
  /locked/,
);
await db.exec("select configure_foil_listing_v2(1,false,500,100,45,0,0,5)");
settings = (await db.query("select admin_foil_settings(1) as s")).rows[0].s;
assert.equal(settings.rulesVersion, 1);
async function pay(order, tag) {
  await db.query("update orders set provider_order_id=$1 where id=$2", [tag, order.orderId]);
  await db.query("select fulfill_stripe_checkout_verified($1,$2,$3,1500,'usd',null)", [
    "event_" + tag,
    tag,
    order.orderId,
  ]);
}
await pay(legacy, "legacy");
assert.equal(
  (await db.query("select tier from mints where order_id=$1", [legacy.orderId])).rows[0].tier,
  "Prismatic",
);
await db.exec("select configure_foil_listing_v2(2,true,8,1,1,1,1,1)");
await assert.rejects(() => db.exec("select configure_foil_listing(2,true,8,1,1,1)"), /six-tier/);
for (let i = 0; i < 8; i++) await pay(await reserve(2), "cap_" + i);
assert.deepEqual(
  (await db.query("select tier from mints where listing_id=2 order by mint_number")).rows.map(
    (x) => x.tier,
  ),
  ["Prismatic", "Sapphire", "Emerald", "Gold", "Silver", "Standard", "Standard", "Standard"],
);
await assert.rejects(() => reserve(2), /slots/);
await assert.rejects(
  () => db.exec("select configure_foil_listing_v2(2,true,8,1,1,0,1,1)"),
  /locked/,
);
// Exercise all 100 equally weighted outcomes with known test bytes; production stays cryptographic.
await db.exec(`create or replace function gen_random_bytes(integer) returns bytea language sql as $$select decode(lpad(to_hex(coalesce(nullif(current_setting('test.roll_byte',true),''),'0')::integer),2,'0'),'hex')$$;
select configure_foil_listing_v2(3,true,1000,100,100,100,100,100);`);
for (let i = 0; i < 100; i++) {
  await db.query("select set_config('test.roll_byte',$1,false)", [String(i)]);
  await pay(await reserve(3), "distribution_" + i);
}
const counts = Object.fromEntries(
  (
    await db.query("select tier,count(*)::int n from mints where listing_id=3 group by tier")
  ).rows.map((x) => [x.tier, x.n]),
);
assert.deepEqual(counts, {
  Standard: 60,
  Silver: 20,
  Gold: 10,
  Emerald: 6,
  Sapphire: 3,
  Prismatic: 1,
});
const catalog = (await db.query("select foil_catalog() as c")).rows[0].c;
assert.equal(catalog.find((x) => x.artworkId === 1).dropRates.Standard, 70);
assert.equal(catalog.find((x) => x.artworkId === 3).dropRates.Emerald, 6);
assert.equal(JSON.stringify(catalog).includes("master.png"), false);
await db.exec("set role anon");
await assert.rejects(() => db.exec("select allocate_paid_foil(gen_random_uuid())"));
await assert.rejects(() =>
  db.exec("select configure_foil_listing_v2(3,true,1000,100,100,100,100,100)"),
);
await db.exec("reset role");
console.log(
  "PASS six-tier distribution, cap downgrade, legacy preservation and private allocation",
);
await db.close();
