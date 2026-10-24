import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
await db.exec(
  `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`,
);
await db.exec(await fs.readFile("supabase/migrations/202610240003_vault_profiles.sql", "utf8"));
const a = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222";
await db.query("insert into auth.users values($1),($2)", [a, b]);
await db.exec(`set role authenticated;set request.jwt.claim.sub='${a}'`);
const address = {
  country: "US",
  firstName: "Test",
  lastName: "Collector",
  addressLine1: "123 Main St",
  city: "Boston",
  state: "MA",
  postCode: "02108",
};
await db.query("insert into vault_profiles(user_id,recipient) values($1,$2)", [a, address]);
await assert.rejects(
  () => db.query("insert into vault_profiles(user_id,recipient) values($1,$2)", [b, address]),
  /row-level/,
);
await db.exec(`set request.jwt.claim.sub='${b}'`);
assert.equal((await db.query("select * from vault_profiles")).rows.length, 0);
assert.equal(
  (await db.query("update vault_profiles set recipient=null where user_id=$1 returning *", [a]))
    .rows.length,
  0,
);
await assert.rejects(
  () =>
    db.query("insert into vault_profiles(user_id,recipient) values($1,$2)", [b, { country: "US" }]),
  /check constraint/,
);
await db.exec("reset role;set role anon");
await assert.rejects(() => db.query("select * from vault_profiles"), /permission denied/);
await db.close();
console.log("PASS private profiles, validation and cross-account isolation");
