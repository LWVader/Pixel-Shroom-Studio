import { it, expect } from "vitest";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
it("locks retired physical tables without deleting historical records or requiring those tables", async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon;create role authenticated;create role service_role;");
    const sql = fs.readFileSync(
      "supabase/migrations/202610100001_retire_physical_checkout.sql",
      "utf8",
    );
    await db.exec(sql);
    await db.exec(
      "create table physical_orders(id int);insert into physical_orders values(1);create table physical_products(id int);grant all on physical_orders,physical_products to anon,authenticated,service_role;",
    );
    await db.exec(sql);
    expect((await db.query("select count(*)::int as n from physical_orders")).rows[0].n).toBe(1);
    await db.exec("set role service_role");
    await expect(db.query("select * from physical_orders")).rejects.toThrow();
    await expect(db.query("select * from physical_products")).rejects.toThrow();
  } finally {
    await db.close();
  }
});
