import { it, expect } from "vitest";
import { canvasProduct, FRAME_OPTIONS } from "../../public/canvas-products-core.js";
import {
  loadGelatoProduct,
  validateCatalogSelection,
} from "../../supabase/functions/_shared/gelato-product.ts";
it("enforces square and portrait tier formats and all three frame finishes", () => {
  expect(Object.keys(FRAME_OPTIONS)).toEqual(["black", "natural", "dark-wood"]);
  for (const tier of ["Standard", "Silver", "Gold"])
    expect(canvasProduct(tier)).toMatchObject({
      size: 16,
      frame: "none",
      label: "16 × 16 thick canvas, unframed",
    });
  for (const tier of ["Emerald", "Sapphire", "Prismatic"])
    for (const frame of Object.keys(FRAME_OPTIONS))
      expect(canvasProduct(tier, frame)).toMatchObject({
        size: tier === "Prismatic" ? 24 : 16,
        height: 24,
        width: tier === "Prismatic" ? 24 : 16,
        frame,
        framed: true,
      });
  expect(() => canvasProduct("Prismatic")).toThrow(/Choose/);
  expect(() => canvasProduct("Emerald", "__proto__")).toThrow();
});
it("loads real supplier catalog data with a read-only server request and never submits an order", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return Response.json({
      productUid: "canvas_test_black",
      attributes: { CanvasFormat: "16x16", FrameColor: "black" },
      isPrintable: true,
      supportedCountries: ["US"],
      notSupportedCountries: [],
    });
  };
  const result = await loadGelatoProduct("canvas_test_black", "fixture-key", fetcher);
  expect(result.attributes.FrameColor).toBe("black");
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe("https://product.gelatoapis.com/v3/products/canvas_test_black");
  expect(calls[0].options.method).toBe("GET");
  expect(calls[0].options).not.toHaveProperty("body");
  await expect(
    loadGelatoProduct("canvas_test_black", "fixture", async () =>
      Response.json({
        productUid: "canvas_test_black",
        isPrintable: true,
        supportedCountries: ["GB"],
      }),
    ),
  ).rejects.toThrow(/United States/);
  await expect(
    loadGelatoProduct(
      "canvas_test_black",
      "fixture",
      async () => new Response("", { status: 404 }),
    ),
  ).rejects.toThrow(/404/);
});

it("rejects catalog size, known frame-color and slim/thick mismatches", () => {
  expect(() =>
    validateCatalogSelection(
      { attributes: { FrameColor: "natural" } },
      canvasProduct("Emerald", "black"),
    ),
  ).toThrow(/frame finish/);
  expect(() =>
    validateCatalogSelection({ attributes: { CanvasFormat: "24x24" } }, canvasProduct("Gold")),
  ).toThrow(/size/);
  expect(() =>
    validateCatalogSelection({ attributes: { CanvasThickness: "slim" } }, canvasProduct("Silver")),
  ).toThrow(/thick/);
  expect(() =>
    validateCatalogSelection(
      { attributes: { FrameColor: "dark wood", CanvasFormat: "600x600-mm" } },
      canvasProduct("Prismatic", "dark-wood"),
    ),
  ).not.toThrow();
});

it("requires dedicated portrait artwork for Emerald and Sapphire", () => {
  for (const tier of ["Emerald", "Sapphire"]) {
    const profile = canvasProduct(tier, "black");
    expect(profile.specs).toMatchObject({ width: 16, height: 24 });
    for (const format of ["16x16", "24x16", "16x20"])
      expect(() =>
        validateCatalogSelection({ attributes: { CanvasFormat: format } }, profile),
      ).toThrow(/size/);
    expect(() =>
      validateCatalogSelection({ attributes: { CanvasFormat: "16x24" } }, profile),
    ).not.toThrow();
  }
});
