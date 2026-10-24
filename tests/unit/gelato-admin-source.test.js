import { it, expect } from "vitest";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { reuseTierPrintSource } from "../../supabase/functions/_shared/gelato-admin-source.ts";
const productId = "11111111-1111-4111-8111-111111111111";
async function fixture(overrides = {}) {
  const bytes = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "#35885a" },
  })
    .png()
    .toBuffer();
  const asset = {
    path: "foil-tiers/7/gold/source.png",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    mime_type: "image/png",
    ...overrides,
  };
  const writes = [],
    filters = [];
  const query = {
    select() {
      return this;
    },
    eq(...args) {
      filters.push(args);
      return this;
    },
    async single() {
      return { data: asset };
    },
  };
  const db = {
    from: () => query,
    storage: {
      from(bucket) {
        return {
          download: async () => ({ data: new Blob([bytes]) }),
          upload: async (path, data) => {
            writes.push({ bucket, path, bytes: Buffer.from(await data.arrayBuffer()) });
            return {};
          },
          createSignedUrl: async () => ({
            data: { signedUrl: "https://private.example/short-lived-preview" },
          }),
        };
      },
    },
  };
  return { db, bytes, writes, filters, asset };
}
it("uses the selected artwork/tier's exact bytes and hash for the private print source", async () => {
  const f = await fixture();
  const result = await reuseTierPrintSource(f.db, productId, 7, "Gold");
  expect(f.filters).toEqual([
    ["listing_id", 7],
    ["tier", "Gold"],
  ]);
  expect(f.writes[0].bytes.equals(f.bytes)).toBe(true);
  expect(f.writes[0].bucket).toBe("gelato-print-files");
  expect(result.facts.sha256).toBe(f.asset.sha256);
  expect(result.path).toMatch(new RegExp(`^gelato/${productId}/[a-f0-9-]+\\.png$`));
  expect(result).toMatchObject({ artworkId: 7, tier: "Gold" });
});
it("rejects changed or unsupported tier sources before copying any file", async () => {
  for (const patch of [{ sha256: "0".repeat(64) }, { mime_type: "image/webp" }]) {
    const f = await fixture(patch);
    await expect(reuseTierPrintSource(f.db, productId, 7, "Gold")).rejects.toThrow();
    expect(f.writes).toEqual([]);
  }
  const f = await fixture();
  await expect(reuseTierPrintSource(f.db, productId, 0, "Gold")).rejects.toThrow();
  await expect(reuseTierPrintSource(f.db, productId, 7, "Unknown")).rejects.toThrow();
});
