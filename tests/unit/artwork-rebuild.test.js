import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { it, expect } from "vitest";

it("deletes reviewed unlinked artwork, protects transaction history and shares the Standard master", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema storage;
      create function auth.uid() returns uuid language sql as $$select '00000000-0000-0000-0000-000000000001'::uuid$$;
      create function public.is_admin() returns boolean language sql as $$select true$$;
      create table artworks(id bigint primary key,title text,serial_number text unique,deleted_at timestamptz,
        preview_url text,original_path text,original_format text,original_width integer,original_height integer);
      create table artwork_signatures(artwork_id bigint references artworks on delete cascade,serial_number text unique);
      create table foil_listings(artwork_id bigint primary key references artworks,master_path text,master_sha256 text);
      create table orders(artwork_id bigint references artworks);
      create table mints(listing_id bigint references foil_listings);
      create table forge_operations(listing_id bigint references foil_listings);
      create table gelato_products(id bigint primary key,edition_artwork_id bigint references foil_listings);
      create table gelato_quotes(product_id bigint references gelato_products);
      create table foil_tier_assets(listing_id bigint references foil_listings,tier text,path text,sha256 text,mime_type text,width integer,height integer,preview_path text,primary key(listing_id,tier));
      create table foil_copy_inventory(listing_id bigint,tier text,foreign key(listing_id,tier) references foil_tier_assets);
      create table storage.objects(bucket_id text,name text);
      insert into artworks(id,title,serial_number,deleted_at) values
        (1,'Hidden','LWV-0000000001',now()),(2,'Ordered','LWV-0000000002',null),(3,'Quoted','LWV-0000000003',null);
      insert into artwork_signatures values(1,'LWV-0000000001'),(2,'LWV-0000000002');
      insert into foil_listings(artwork_id) values(1),(3);
      insert into foil_tier_assets(listing_id,tier) values(1,'Standard');
      insert into foil_copy_inventory values(1,'Standard');
      insert into orders values(2);
      insert into gelato_products values(1,1),(3,3);
      insert into gelato_quotes values(3);
    `);
    await db.exec(await readFile("supabase/migrations/202611130001_artwork_rebuild.sql", "utf8"));
    expect((await db.query("select count(*)::int n from artworks")).rows[0].n).toBe(3);
    await expect(
      db.query("select delete_unlinked_artworks_for_rebuild(array[1,2]::bigint[])"),
    ).rejects.toThrow("changed");
    await db.exec(
      "create or replace function public.is_admin() returns boolean language sql as $$select false$$",
    );
    await expect(db.query("select preview_artwork_rebuild()")).rejects.toThrow(
      "Admin access required",
    );
    await db.exec(
      "create or replace function public.is_admin() returns boolean language sql as $$select true$$",
    );
    expect(
      (await db.query("select delete_unlinked_artworks_for_rebuild(array[1]::bigint[]) n")).rows[0]
        .n,
    ).toBe(1);
    expect(
      (await db.query("select id from artworks order by id")).rows.map((r) => Number(r.id)),
    ).toEqual([2, 3]);
    expect(
      (await db.query("select serial_number from artwork_signatures")).rows.map(
        (r) => r.serial_number,
      ),
    ).toEqual(["LWV-0000000002"]);
    const preview = "artworks/11111111-1111-4111-8111-111111111111-protected-preview.webp";
    await db.query(
      "insert into artworks values(4,'Reloaded','LWV-0000000001',null,$1,'signed.png','image/png',4800,4800)",
      ["https://example.invalid/" + preview],
    );
    await db.exec(
      "insert into foil_listings values(4,'signed.png',repeat('a',64)); insert into storage.objects values('originals','signed.png');",
    );
    await expect(db.query("select set_standard_tier_from_master(4,$1)", [preview])).rejects.toThrow(
      "required",
    );
    await db.query("insert into storage.objects values('previews',$1)", [preview]);
    await db.query("select set_standard_tier_from_master(4,$1)", [preview]);
    expect(
      (await db.query("select path,preview_path from foil_tier_assets where listing_id=4")).rows[0],
    ).toEqual({ path: "signed.png", preview_path: preview });
  } finally {
    await db.close();
  }
});
