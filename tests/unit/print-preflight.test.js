import { it, expect } from "vitest";
import sharp from "sharp";
import { inspectPrintBytes, evaluatePrint } from "../../public/print-preflight-core.js";
const specs = {
  width: 8,
  height: 10,
  bleedMm: 0,
  wrapMm: 0,
  safeMm: 4,
  minimumDpi: 150,
  transparent: false,
  templateUrl: "https://dashboard.gelato.com/catalogue/categories",
};
const reviews = {};
const raw = (buffer) =>
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
it("reads actual PNG/JPEG headers and ignores fake MIME types/extensions", async () => {
  const png = await sharp({
    create: {
      width: 2400,
      height: 3000,
      channels: 4,
      background: { r: 20, g: 50, b: 90, alpha: 0.8 },
    },
  })
    .png()
    .toBuffer();
  const facts = inspectPrintBytes(raw(png));
  expect(facts).toMatchObject({ width: 2400, height: 3000, format: "png", alphaChannel: true });
  expect(evaluatePrint(facts, specs, reviews)).toMatchObject({
    state: "ready",
    dpi: 300,
    target: [2400, 3000],
  });
  const jpeg = await sharp(png).jpeg().toBuffer();
  expect(inspectPrintBytes(raw(jpeg))).toMatchObject({
    width: 2400,
    height: 3000,
    format: "jpg",
    alphaChannel: false,
  });
  expect(() =>
    inspectPrintBytes(raw(Buffer.from("This is not an image even when named artwork.png"))),
  ).toThrow();
  expect(() => inspectPrintBytes(raw(png.subarray(0, png.length - 15)))).toThrow();
});
it("blocks low resolution, wrong aspect ratios and absent alpha without requiring manual review", () => {
  const facts = {
    bytes: 10000,
    format: "jpg",
    width: 800,
    height: 600,
    alphaChannel: false,
    profile: "unknown",
  };
  const result = evaluatePrint(facts, { ...specs, transparent: true }, {});
  expect(result.state).toBe("blocked");
  expect(result.errors.join(" ")).toMatch(/Resolution.*aspect ratio.*PNG/s);
  expect(evaluatePrint({ ...facts, width: 1200, height: 1500 }, specs, reviews)).toMatchObject({
    state: "ready",
    dpi: 150,
  });
  expect(
    evaluatePrint({ ...facts, width: 1200, height: 1500 }, { ...specs, minimumDpi: 300 }, reviews)
      .state,
  ).toBe("blocked");
});
it("includes bleed and wrap in target size instead of using DPI metadata", () => {
  const facts = { bytes: 10000, format: "png", width: 2400, height: 3000, profile: "unknown" };
  const result = evaluatePrint(facts, { ...specs, bleedMm: 4, wrapMm: 20 }, reviews);
  expect(result.target).toEqual([2967, 3567]);
  expect(result.dpi).toBeLessThan(250);
  expect(result.errors.join(" ")).toMatch(/aspect ratio/);
  expect(() =>
    evaluatePrint(facts, { ...specs, templateUrl: "https://gelato.com.evil.test" }, reviews),
  ).toThrow();
  expect(() => evaluatePrint(facts, { ...specs, width: 0 }, reviews)).toThrow();
});
it("labels PDF checks as external review and does not invent pixel dimensions or profile approval", () => {
  const pdf = inspectPrintBytes(raw(Buffer.from("%PDF-1.7\n external preflight required\n%%EOF")));
  expect(evaluatePrint(pdf, specs, reviews).state).toBe("blocked");
  const result = evaluatePrint(pdf, specs, { ...reviews, pdf: true });
  expect(result.state).toBe("blocked");
  expect(result.dpi).toBeNull();
  expect(result.warnings.join(" ")).toMatch(/external preflight/);
});

it("server re-reads the private bytes, rejects changed hashes and gates publishing independently", async () => {
  const { validatePrintMapping, inspectStoredPrint } =
    await import("../../supabase/functions/_shared/print-preflight.ts");
  const bytes = await sharp({
    create: { width: 600, height: 600, channels: 4, background: "#407050" },
  })
    .png()
    .toBuffer();
  const db = {
    storage: { from: () => ({ download: async () => ({ data: new Blob([bytes]), error: null }) }) },
  };
  const facts = await inspectStoredPrint(db, "private.png");
  const product = {
    print_path: "private.png",
    active: true,
    publish_confirmed: true,
    preflight_hash: facts.sha256,
    print_specs: { ...specs, width: 2, height: 2 },
    preflight_reviews: reviews,
  };
  expect((await validatePrintMapping(db, product)).report.state).toBe("ready");
  await expect(
    validatePrintMapping(db, { ...product, preflight_hash: "0".repeat(64) }),
  ).rejects.toThrow(/changed/);
  await expect(validatePrintMapping(db, { ...product, publish_confirmed: false })).rejects.toThrow(
    /publish/,
  );
  await expect(validatePrintMapping(db, { ...product, print_path: "private.jpg" })).rejects.toThrow(
    /format/,
  );
  const draft = await validatePrintMapping(db, {
    ...product,
    active: false,
    publish_confirmed: false,
    preflight_reviews: {},
  });
  expect(draft.report.state).toBe("ready");
});
