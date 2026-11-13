import sharp from "sharp";

export const UPLOAD_TARGET_BYTES = 9 * 1024 * 1024;

// PNG may contain an existing C2PA manifest that re-encoding would discard.
function hasPngManifest(bytes) {
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) break;
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type === "caBX") return true;
    if (type === "IEND") break;
    offset += length + 12;
  }
  return false;
}

export async function optimizeArtworkPng(bytes) {
  const input = sharp(bytes, { limitInputPixels: 100_000_000 });
  const info = await input.metadata();
  if (info.format !== "png") throw new Error("Only PNG artwork can be optimized here.");
  if (bytes.length <= UPLOAD_TARGET_BYTES || info.pages > 1 || hasPngManifest(bytes)) return bytes;

  // Avoid color conversion for high-precision or non-RGB inputs.
  if (info.bitsPerSample === 16 || info.space !== "srgb") return bytes;
  const opaque = info.hasAlpha && (await input.stats()).isOpaque;
  let output = input.keepMetadata();
  if (opaque) output = output.removeAlpha();
  const compressed = await output
    .png({
      compressionLevel: 9,
      adaptiveFiltering: true,
    })
    .toBuffer();
  return compressed.length < bytes.length ? compressed : bytes;
}
