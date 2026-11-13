import { expect, it } from "vitest";
import sharp from "sharp";
import { artworkImageInfo } from "../../tools/artwork-image-info.mjs";

const image = () => sharp({ create: { width: 16, height: 16, channels: 3, background: "green" } });

it("prefers a serial in the image information and falls back to the file name", async () => {
  const png = await image()
    .withExif({ IFD0: { ImageDescription: "Studio serial LWV-3249949452" } })
    .png()
    .toBuffer();
  expect(await artworkImageInfo(png, "different-LWV-0000000001.png")).toEqual({
    serial: "LWV-3249949452",
    source: "metadata",
  });
  const jpeg = await image().jpeg().toBuffer();
  expect(await artworkImageInfo(jpeg, "Artwork_LWV-12345678901_4800x4800.jpg")).toEqual({
    serial: "LWV-12345678901",
    source: "filename",
  });
  await expect(artworkImageInfo(jpeg, "untitled.jpg")).rejects.toThrow("No LWV serial");
  await expect(artworkImageInfo(jpeg, "LWV-0000000001-LWV-0000000002.jpg")).rejects.toThrow(
    "Multiple serials",
  );
});
