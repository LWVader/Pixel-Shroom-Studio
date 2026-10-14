import { it, expect } from "vitest";
import fs from "node:fs";
import { load } from "cheerio";
import { PGlite } from "@electric-sql/pglite";
import {
  GENRES,
  validRows,
  cardMarkup,
  artworkInformation,
  readPublishedArtworks,
} from "../../public/catalog-core.js";
import { GENRE_CORRECTIONS } from "../../public/studio-catalog.js";
import {
  renderFeatured,
  renderProductExamples,
  renderFeedback,
} from "../../public/studio-home-core.js";
const row = {
  id: 47,
  title: "Haunted Lightning Portal",
  category: "Portrait",
  serial_number: "LWV-1076123371",
  price: 15,
  preview_url: "https://example.com/protected.webp",
  artist: "LWVader",
  display_width: 600,
  display_height: 600,
};
it("corrects reviewed genres without changing IDs, prices or later editorial choices", () => {
  for (const [serial, change] of Object.entries(GENRE_CORRECTIONS)) {
    const original = { ...row, serial_number: serial, category: change.from };
    expect(validRows([original])[0]).toEqual({ ...original, category: change.to });
    expect(original.category).toBe(change.from);
    expect(validRows([{ ...original, category: "Sci-Fi" }])[0].category).toBe("Sci-Fi");
  }
  expect(Object.keys(GENRES)).toHaveLength(9);
});
it("does not substitute preview dimensions or formats for original specifications", () => {
  expect(artworkInformation(row)).toContain("Not recorded");
  expect(artworkInformation(row)).not.toContain("600 × 600");
  const info = artworkInformation({
    ...row,
    original_width: 7086,
    original_height: 10629,
    original_format: "image/png",
    original_dimensions_source: "decoded",
  });
  expect(info).toContain("7,086 × 10,629 px");
  expect(info).toContain("PNG");
  expect(info).toContain("Nonexclusive");
  expect(info).toContain("redistribution and resale");
  const card = cardMarkup(row);
  expect(card.indexOf("What you’ll receive")).toBeLessThan(card.indexOf("data-buy"));
  expect(card).toContain('data-buy="47"');
  expect(card).toContain('data-provider="stripe"');
});
it("supports the old schema and joins only public original MIME metadata", async () => {
  const rows = await readPublishedArtworks("https://example.com", "public", {
    fetcher: async (url) => {
      if (url.includes("artwork_signatures"))
        return Response.json([
          { artwork_id: 47, mime_type: "image/png", original_path: "never-copy" },
        ]);
      if (url.includes("original_width")) return new Response(null, { status: 400 });
      return Response.json([row]);
    },
  });
  expect(rows[0].original_format).toBe("image/png");
  expect(rows[0]).not.toHaveProperty("original_path");
  expect(rows[0].category).toBe("Dark Fantasy");
});
it("uses protected featured previews and direct eBay product destinations", () => {
  const $ = load(renderFeatured(validRows([row])));
  expect($(".featured-card")).toHaveLength(1);
  expect($("img").attr("src")).toBe(row.preview_url);
  expect($("a").attr("href")).toContain("genre=dark-fantasy&search=");
  const catalog = {
    seller: "lwvader",
    storeUrl: "https://www.ebay.com/sch/i.html?_ssn=lwvader",
    items: [
      {
        itemId: "198704466185",
        seller: "lwvader",
        category: "canvas",
        title: "Canvas",
        imageUrl: "https://i.ebayimg.com/images/g/test/s-l140.jpg",
        active: true,
      },
    ],
  };
  expect(renderProductExamples(catalog)).toContain("https://www.ebay.com/itm/198704466185");
  expect(renderProductExamples(catalog)).toContain("s-l1200");
});
it("requires purchase verification and publication consent for customer quotes", () => {
  expect(renderFeedback([])).toBe("");
  expect(renderFeedback([{ name: "Someone", quote: "Great" }])).toBe("");
  expect(
    renderFeedback([
      {
        name: "Customer",
        quote: "<script>x</script>",
        published: true,
        permissionGranted: true,
        verifiedPurchase: true,
      },
    ]),
  ).toContain("&lt;script&gt;");
});
it("preserves the hero, latest gallery and honest hidden states", () => {
  const $ = load(fs.readFileSync("public/index.html", "utf8"));
  expect($(".shop-path")).toHaveLength(3);
  expect($(".hero img").attr("src")).toBe("/assets/hero-1280.webp");
  expect($("#journal").attr("hidden")).toBeDefined();
  expect($("#customer-feedback").attr("hidden")).toBeDefined();
  expect($("#studio-updates-form [name=consent]").attr("required")).toBeDefined();
  expect($("#catalog").attr("data-mode")).toBe("latest");
});
it("migrates metadata and genres idempotently without changing originals or price", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "create table artworks(id bigint primary key,serial_number text,category text,price numeric,display_width int,display_height int,original_path text);create table artwork_signatures(artwork_id bigint,serial_number text,mime_type text);insert into artworks values(47,'LWV-1076123371','Portrait',15,1254,1254,'private/original.png');insert into artwork_signatures values(47,'LWV-1076123371','image/png');",
    );
    const sql = fs.readFileSync(
      "supabase/migrations/202610140001_buyer_metadata_and_genre_review.sql",
      "utf8",
    );
    await db.exec(sql);
    await db.exec(sql);
    const r = (await db.query("select * from artworks")).rows[0];
    expect(r.category).toBe("Dark Fantasy");
    expect(Number(r.price)).toBe(15);
    expect(r.original_path).toBe("private/original.png");
    expect(r.original_width).toBe(1254);
    expect(r.original_format).toBe("image/png");
    expect(r.original_dimensions_source).toBe("registered");
    await expect(db.exec("update artworks set original_width=-1")).rejects.toThrow();
  } finally {
    await db.close();
  }
});
