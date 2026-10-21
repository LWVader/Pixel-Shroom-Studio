import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { feeBreakdown, connectRedirectUrl, marketPreviewUrl } from "../../public/market-core.js";
import { renderMarketPreview, sha256 } from "../../mint-worker/render.mjs";
it("enforces transactional resale, fees, ownership revocation and refund-chain holds", () => {
  expect(
    execFileSync(process.execPath, ["tests/market-database.mjs"], { encoding: "utf8" }),
  ).toContain("PASS");
});
it("quotes the ten-percent gross split and rejects unsafe redirects or preview paths", () => {
  expect(feeBreakdown(5000)).toEqual({ price: 5000, fee: 500, seller: 4500 });
  expect(feeBreakdown(155)).toEqual({ price: 155, fee: 16, seller: 139 });
  expect(() => feeBreakdown(1)).toThrow();
  expect(() => connectRedirectUrl("https://evil.example/")).toThrow();
  expect(connectRedirectUrl("https://connect.stripe.com/setup/test")).toContain(
    "connect.stripe.com",
  );
  expect(() =>
    marketPreviewUrl("../originals/private.webp", "https://fixture.supabase.co"),
  ).toThrow();
});
it("creates a protected public derivative without changing the private minted file", async () => {
  const original = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: "#8a258b" },
  })
    .webp()
    .toBuffer();
  const initial = sha256(original);
  const output = await renderMarketPreview(original, { sha256: initial, mintNumber: 42 });
  const metadata = await sharp(output).metadata();
  expect(metadata.width).toBe(960);
  expect(metadata.height).toBe(640);
  expect(sha256(output)).not.toBe(initial);
  expect(sha256(original)).toBe(initial);
  const small = await sharp({
    create: { width: 128, height: 96, channels: 3, background: "#8a258b" },
  })
    .webp()
    .toBuffer();
  await expect(
    renderMarketPreview(small, { sha256: sha256(small), mintNumber: 1 }),
  ).resolves.toBeInstanceOf(Buffer);
  await expect(renderMarketPreview(original, { sha256: "bad", mintNumber: 1 })).rejects.toThrow(
    "hash mismatch",
  );
});
it("validates destination payments and idempotent refund routing", () => {
  expect(
    execFileSync(process.execPath, ["tests/market-payments.cjs"], { encoding: "utf8" }),
  ).toContain("PASS");
});
it("uses authenticated identities and server price snapshots and rejects user reconciliation", () => {
  expect(execFileSync(process.execPath, ["tests/market-api.cjs"], { encoding: "utf8" })).toContain(
    "PASS",
  );
});
