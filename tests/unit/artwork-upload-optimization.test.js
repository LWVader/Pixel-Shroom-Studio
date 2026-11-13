import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { expect, it } from "vitest";
import {
  optimizeArtworkPng,
  UPLOAD_TARGET_BYTES,
} from "../../tools/artwork-upload-optimization.mjs";

it("shrinks opaque PNGs while preserving dimensions, pixels and print density", async () => {
  const width = 1600;
  const height = 1600;
  const raw = randomBytes(width * height * 4);
  for (let i = 3; i < raw.length; i += 4) raw[i] = 255;
  const source = await sharp(raw, { raw: { width, height, channels: 4 } })
    .withMetadata({ density: 300 })
    .png({ compressionLevel: 0 })
    .toBuffer();
  expect(source.length).toBeGreaterThan(UPLOAD_TARGET_BYTES);
  const optimized = await optimizeArtworkPng(source);
  expect(optimized.length).toBeLessThan(UPLOAD_TARGET_BYTES);
  expect(await sharp(optimized).metadata()).toMatchObject({ width, height, density: 300 });
  expect((await sharp(optimized).ensureAlpha().raw().toBuffer()).equals(raw)).toBe(true);

  // An existing C2PA chunk prevents any re-encoding.
  const manifest = Buffer.from([0, 0, 0, 0, 99, 97, 66, 88, 0, 0, 0, 0]);
  const signed = Buffer.concat([source.subarray(0, -12), manifest, source.subarray(-12)]);
  expect(await optimizeArtworkPng(signed)).toBe(signed);
});
