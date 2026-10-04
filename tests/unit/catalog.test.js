import { describe, it, expect, vi } from "vitest";
import * as core from "../../public/catalog-core.js";
const row = {
  id: 1,
  title: "<script>alert(1)</script>",
  category: "Fantasy",
  price: 15,
  preview_url: "https://example.com/image.png",
  serial_number: "A",
  artist: "Artist",
};
describe("catalog and provider boundaries", () => {
  it("allows exactly nine genres", () =>
    expect(Object.keys(core.GENRES)).toEqual([
      "portrait",
      "fantasy",
      "landscape",
      "sci-fi",
      "abstract",
      "dreamscape",
      "dark-fantasy",
      "horror",
      "nft",
    ]));
  it("escapes dynamic artwork content and rejects executable previews", () => {
    expect(core.cardMarkup(row)).not.toContain("<script>");
    expect(core.safePreviewUrl("javascript:alert(1)")).toBe("");
    expect(core.validRows([row, { ...row, price: 0 }, { ...row, category: "Other" }])).toEqual([
      row,
    ]);
  });
  it("samples without mutating source and limits each collection", () => {
    const rows = Array.from({ length: 8 }, (_, id) => ({ ...row, id }));
    expect(core.randomSample(rows, 4, () => 0)).toHaveLength(4);
    expect(rows[0].id).toBe(0);
    expect(core.renderCompiled(rows).match(/class="art-card"/g)).toHaveLength(4);
    expect(core.renderGenre(rows, "fantasy").match(/class="art-card"/g)).toHaveLength(8);
  });
  it("searches serial and artist, preserves empty genre links and disables NFT purchases", () => {
    expect(core.renderGenre([row], "fantasy", { term: "Artist" })).toContain("art-card");
    expect(core.renderGenre([row], "fantasy", { term: "missing" })).toContain(
      "No matching artwork",
    );
    expect(core.renderCompiled([])).toContain("genre=nft");
    expect(core.cardMarkup({ ...row, category: "NFT" })).not.toContain("data-buy");
  });
  it.each([
    "http://checkout.stripe.com/x",
    "https://checkout.stripe.com.evil.test",
    "https://user@checkout.stripe.com",
    "https://checkout.stripe.com:444",
  ])("rejects unsafe checkout %s", (url) =>
    expect(() => core.checkoutUrl(url, "stripe")).toThrow(),
  );
  it("allows official Stripe and PayPal HTTPS destinations", () => {
    expect(core.checkoutUrl("https://checkout.stripe.com/c/pay", "stripe")).toContain("/c/pay");
    expect(core.checkoutUrl("https://www.paypal.com/checkoutnow", "paypal")).toContain(
      "paypal.com",
    );
  });
  it("paginates public fields and rejects repeat pages", async () => {
    const page = Array.from({ length: 1000 }, (_, id) => ({ ...row, id }));
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(page))
      .mockResolvedValueOnce(Response.json([{ ...row, id: 1001 }]));
    expect(
      await core.readPublishedArtworks("https://example.test", "key", { fetcher }),
    ).toHaveLength(1001);
    expect(fetcher.mock.calls[1][0]).toContain("offset=1000");
    expect(fetcher.mock.calls[0][0]).not.toContain("original_path");
    await expect(
      core.readPublishedArtworks("https://example.test", "key", {
        fetcher: async () => Response.json(page),
      }),
    ).rejects.toThrow("did not advance");
  });
  it("reports failed and malformed catalog responses", async () => {
    await expect(
      core.readPublishedArtworks("https://test", "key", {
        fetcher: async () => new Response("", { status: 500 }),
      }),
    ).rejects.toThrow();
    await expect(
      core.readPublishedArtworks("https://test", "key", { fetcher: async () => Response.json({}) }),
    ).rejects.toThrow();
  });
});
