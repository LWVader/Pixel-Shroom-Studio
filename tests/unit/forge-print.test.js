import { execFileSync } from "node:child_process";
import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { load } from "cheerio";
import {
  PLANNED_OFFERS,
  TIER_FINISHES,
  forgeEstimate,
  readSelections,
  writeSelections,
  rollPaths,
  safeArtworkId,
} from "../../public/forge-print-core.js";
import { renderArtworkDetail } from "../../public/artwork-page-core.js";
it("keeps new roll selection separate from existing checkout and protects public artwork text", () => {
  const row = {
    id: 1,
    title: "<script>alert(1)</script>",
    category: "Fantasy",
    serial_number: "LWV-0000000001",
    price: 15,
    preview_url: "https://example.com/preview.png",
  };
  const html = renderArtworkDetail(row);
  expect(html).not.toContain(row.title);
  expect(html).toContain("&lt;script&gt;");
  const $ = load(html);
  expect($('[data-buy="1"]')).toHaveLength(1);
  expect($(".roll-paths a")).toHaveLength(2);
  expect($("#roll-purchase input[name=offer]")).toHaveLength(2);
  expect($("#roll-purchase button").attr("disabled")).toBeDefined();
  expect($(".legacy-detail [data-buy]")).toHaveLength(1);
  expect(rollPaths({ ...row, category: "NFT" })).toBe("");
  expect(PLANNED_OFFERS.canvas.price + PLANNED_OFFERS.canvas.shipping).toBe(82.49);
  expect(TIER_FINISHES.reduce((n, t) => n + t.odds, 0)).toBe(100);
  expect(
    TIER_FINISHES.filter((t) => !["Standard", "Silver"].includes(t.tier)).reduce(
      (n, t) => n + t.odds,
      0,
    ),
  ).toBe(20);
});
it("calculates whole same-tier upgrades without manufacturing partial outputs", () => {
  expect(forgeEstimate("Standard", 30)).toMatchObject({ to: "Silver", outputs: 6, remaining: 0 });
  expect(forgeEstimate("Gold", 2)).toMatchObject({ outputs: 0, remaining: 2 });
  expect(() => forgeEstimate("Gold", 1.5)).toThrow();
  expect(() => forgeEstimate("Prismatic", 5)).toThrow();
});
it("reads only valid artwork IDs/offer names and ignores injected prices or malformed storage", () => {
  let value = JSON.stringify([
    { artworkId: "1", offer: "canvas", price: 0 },
    { artworkId: "2", offer: "__proto__" },
    { artworkId: "evil", offer: "digital" },
  ]);
  const storage = { getItem: () => value, setItem: (k, v) => (value = v) };
  expect(readSelections(storage)).toEqual([{ artworkId: "1", offer: "canvas" }]);
  writeSelections(storage, [{ artworkId: "1", offer: "canvas", token: "do-not-store" }]);
  expect(value).not.toContain("token");
  value = "{}";
  expect(readSelections(storage)).toEqual([]);
  expect(safeArtworkId("1&offer=canvas")).toBe(false);
});
it("new routes are linked, indexable guides have canonical metadata, and cart stays private", () => {
  for (const page of ["forge", "drop-odds", "canvas-specs", "art", "cart"]) {
    const $ = load(readFileSync(`public/${page}.html`, "utf8"));
    expect($("h1")).toHaveLength(1);
    expect($("link[rel=canonical]").attr("href")).toContain(`/${page}.html`);
    expect($('.category-nav a[href^="/genre.html?genre="]')).toHaveLength(9);
  }
  const cart = load(readFileSync("public/cart.html", "utf8"));
  expect(cart("meta[name=robots]").attr("content")).toContain("noindex");
});

it("enforces transactional Forge and prepaid canvas boundaries in PostgreSQL", () => {
  expect(
    execFileSync(process.execPath, ["tests/forge-loop-database.mjs"], { encoding: "utf8" }),
  ).toContain("PASS");
});
