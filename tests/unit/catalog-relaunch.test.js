import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { load } from "cheerio";
import { cardMarkup, editionActionsMarkup } from "../../public/catalog-core.js";
it("catalog relaunch requires admin, rejects stale counts and preserves issued records", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql as $$select '11111111-1111-4111-8111-111111111111'::uuid$$;
      create function public.is_admin() returns boolean language sql as $$select coalesce(current_setting('test.admin',true),'no')='yes'$$;
      create table artworks(id bigint primary key,status text,deleted_at timestamptz,updated_at timestamptz,original_path text);
      create table foil_listings(artwork_id bigint primary key references artworks(id),enabled boolean);
      create table orders(id bigint primary key,artwork_id bigint references artworks(id),status text);
      create table mints(id bigint primary key,listing_id bigint references artworks(id),tier text,hash text);
      insert into artworks values(1,'published',null,now(),'private/master.png'),(2,'draft',null,now(),'private/other.png');
      insert into foil_listings values(1,true);insert into orders values(1,1,'paid');insert into mints values(1,1,'Gold','signed-copy-hash');`);
    await db.exec(readFileSync("supabase/migrations/202610210001_catalog_relaunch.sql", "utf8"));
    expect(
      (await db.query("select count(*)::int n from artworks where deleted_at is null")).rows[0].n,
    ).toBe(2);
    await expect(db.query("select archive_catalog_for_relaunch(2)")).rejects.toThrow(
      "Admin access required",
    );
    await db.exec("set test.admin='yes'");
    await expect(db.query("select archive_catalog_for_relaunch(1)")).rejects.toThrow(
      "Catalog changed",
    );
    expect((await db.query("select enabled from foil_listings")).rows[0].enabled).toBe(true);
    const result = (await db.query("select archive_catalog_for_relaunch(2) result")).rows[0].result;
    expect(result.archived).toBe(2);
    expect(
      (
        await db.query(
          "select count(*)::int n from artworks where status='published' and deleted_at is null",
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (await db.query("select original_path from artworks where id=1")).rows[0].original_path,
    ).toBe("private/master.png");
    expect((await db.query("select * from mints")).rows[0].hash).toBe("signed-copy-hash");
    expect((await db.query("select status from orders")).rows[0].status).toBe("paid");
    expect((await db.query("select enabled from foil_listings")).rows[0].enabled).toBe(false);
    expect(
      (await db.query("select previous_listings from catalog_relaunch_runs")).rows[0]
        .previous_listings,
    ).toHaveLength(2);
    expect(
      (await db.query("select archive_catalog_for_relaunch(0) result")).rows[0].result.archived,
    ).toBe(0);
  } finally {
    await db.close();
  }
});
it("edition cards disclose tiers and sizes without exposing private assets", () => {
  const edition = {
    artworkId: 3,
    enabled: true,
    totalMinted: 4,
    maxSupply: 500,
    reserved: 1,
    prismaticsRemaining: 5,
    rulesVersion: 2,
    tierImages: [{ tier: "Gold", width: 2000, height: 3000, path: "private/source.png" }],
  };
  const $ = load(editionActionsMarkup(edition));
  expect($(".edition-tier-list span")).toHaveLength(6);
  expect($(".edition-dimensions").text()).toContain("2000 × 3000 px");
  expect($(".edition-buy").attr("href")).toBe("/collection.html?mint=3");
  expect($.html()).not.toContain("private/source.png");
  expect($("details[open]")).toHaveLength(0);
  expect(
    load(editionActionsMarkup({ ...edition, enabled: false }))(".edition-buy").attr("href"),
  ).toBeUndefined();
});
