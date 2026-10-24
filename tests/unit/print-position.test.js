import { it, expect } from "vitest";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { positionGeometry, positionedResolution } from "../../public/print-position-core.js";
import { validatePositionedSource } from "../../supabase/functions/_shared/print-preflight.ts";
const specs = { width: 16, height: 20, bleedMm: 0, wrapMm: 0, safeMm: 4, minimumDpi: 150 };
it("keeps every permitted crop inside the source, across canvas ratios and drag limits", () => {
  for (const [w, h] of [
    [5000, 4000],
    [4000, 6000],
    [5000, 5000],
  ])
    for (const zoom of [1, 2, 4])
      for (const panX of [-1, 0, 1])
        for (const panY of [-1, 0, 1]) {
          const crop = positionGeometry(w, h, 16, 20, { zoom, panX, panY });
          expect(crop.sourceX).toBeGreaterThanOrEqual(-0.00001);
          expect(crop.sourceY).toBeGreaterThanOrEqual(-0.00001);
          expect(crop.sourceX + crop.cropWidth).toBeLessThanOrEqual(w + 0.00001);
          expect(crop.sourceY + crop.cropHeight).toBeLessThanOrEqual(h + 0.00001);
          expect(crop.cropWidth / crop.cropHeight).toBeCloseTo(16 / 20);
        }
});
it("uses real cropped pixels instead of enlarged export dimensions to gate print quality", () => {
  expect(positionedResolution(3000, 4000, specs, {})).toMatchObject({
    width: 3000,
    height: 3750,
    effectivePpi: 187.5,
  });
  expect(() => positionedResolution(3000, 4000, specs, { zoom: 2 })).toThrow(/93.8 PPI/);
  expect(() => positionedResolution(2400, 2400, specs, {})).toThrow(/120.0 PPI/);
  expect(() => positionGeometry(4000, 4000, 16, 20, { panX: 2 })).toThrow(/invalid/);
  const wrapped = positionedResolution(6000, 6000, { ...specs, wrapMm: 20, bleedMm: 4 }, {});
  expect(wrapped.widthIn).toBeGreaterThan(16);
  expect(wrapped.heightIn).toBeGreaterThan(20);
});
it("server verifies the original source hash and rejects false dimensions and overstated crop quality", async () => {
  const bytes = await sharp({
    create: { width: 600, height: 600, channels: 3, background: "#125b42" },
  })
    .png()
    .toBuffer();
  const hash = createHash("sha256").update(bytes).digest("hex");
  const db = { storage: { from: () => ({ download: async () => ({ data: new Blob([bytes]) }) }) } };
  const id = "11111111-1111-4111-8111-111111111111";
  const product = {
    id,
    position: {
      source_path: `gelato/${id}/${id}.png`,
      source_sha256: hash,
      zoom: 1,
      panX: 0,
      panY: 0,
    },
  };
  const report = { specs: { ...specs, width: 2, height: 2 } };
  expect(
    (await validatePositionedSource(db, product, report, { width: 600, height: 600 }))
      .effectiveSourcePpi,
  ).toBe(300);
  await expect(
    validatePositionedSource(
      db,
      { ...product, position: { ...product.position, source_sha256: "0".repeat(64) } },
      report,
    ),
  ).rejects.toThrow(/changed/);
  await expect(
    validatePositionedSource(db, product, report, { width: 1200, height: 1200 }),
  ).rejects.toThrow(/dimensions/);
  await expect(
    validatePositionedSource(
      db,
      { ...product, position: { ...product.position, zoom: 4 } },
      report,
    ),
  ).rejects.toThrow(/75.0 PPI/);
});
