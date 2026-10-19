import { crc32 } from "node:zlib";
// Version 1: add a private copy identifier without touching encoded pixel data.
export function prepareCopyImage(bytes, mimeType, copy) {
  const identity = Buffer.from(
    JSON.stringify({
      version: 1,
      copyId: copy.id,
      listingId: String(copy.listing_id),
      tier: copy.tier,
      copyNumber: copy.copy_number,
      sourceSha256: copy.source_sha256,
    }),
  );
  let output;
  if (mimeType === "image/png") {
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
      throw Error("Invalid PNG");
    let offset = 8;
    while (
      offset + 12 <= bytes.length &&
      bytes.toString("ascii", offset + 4, offset + 8) !== "IEND"
    ) {
      offset += 12 + bytes.readUInt32BE(offset);
    }
    if (offset + 12 > bytes.length) throw Error("PNG end missing");
    const data = Buffer.concat([Buffer.from("PixelShroomCopy\0"), identity]);
    const chunk = Buffer.alloc(data.length + 12);
    chunk.writeUInt32BE(data.length, 0);
    chunk.write("tEXt", 4);
    data.copy(chunk, 8);
    chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
    output = Buffer.concat([bytes.subarray(0, offset), chunk, bytes.subarray(offset)]);
  } else if (mimeType === "image/jpeg") {
    if (bytes.readUInt16BE(0) !== 0xffd8) throw Error("Invalid JPEG");
    let offset = 2;
    while (
      offset + 4 <= bytes.length &&
      bytes[offset] === 255 &&
      ((bytes[offset + 1] >= 0xe0 && bytes[offset + 1] <= 0xef) || bytes[offset + 1] === 0xfe)
    ) {
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2 || offset + length + 2 > bytes.length) throw Error("Invalid JPEG metadata");
      offset += length + 2;
    }
    const data = Buffer.concat([Buffer.from("PixelShroomCopy\0"), identity]);
    const chunk = Buffer.alloc(4);
    chunk.writeUInt16BE(0xffef, 0);
    chunk.writeUInt16BE(data.length + 2, 2);
    output = Buffer.concat([bytes.subarray(0, offset), chunk, data, bytes.subarray(offset)]);
  } else if (mimeType === "image/webp") {
    if (
      bytes.toString("ascii", 0, 4) !== "RIFF" ||
      bytes.toString("ascii", 8, 12) !== "WEBP" ||
      bytes.readUInt32LE(4) + 8 !== bytes.length
    )
      throw Error("Invalid WebP");
    const chunk = Buffer.alloc(8 + identity.length + (identity.length % 2));
    chunk.write("PSSI", 0);
    chunk.writeUInt32LE(identity.length, 4);
    identity.copy(chunk, 8);
    output = Buffer.concat([bytes, chunk]);
    output.writeUInt32LE(output.length - 8, 4);
  } else throw Error("Unsupported copy format");
  if (output.length > 104857600) throw Error("Copy exceeds storage limit");
  return output;
}
