import sharp from "sharp";

function serials(text) {
  return [
    ...new Set(
      String(text ?? "")
        .toUpperCase()
        .match(/(?<![A-Z0-9])LWV-\d{10,11}(?![A-Z0-9])/g) || [],
    ),
  ];
}

export async function artworkImageInfo(bytes, filename) {
  const info = await sharp(bytes, { limitInputPixels: 100_000_000 }).metadata();
  if (!["png", "jpeg", "webp"].includes(info.format)) throw Error("Choose a PNG, JPEG or WebP.");
  const text = [
    ...(info.comments || []).map(({ text }) => text),
    ...[info.xmp, info.exif, info.iptc]
      .filter(Boolean)
      .flatMap((value) => [
        value.toString("utf8"),
        value.toString("utf16le"),
        value.subarray(1).toString("utf16le"),
      ]),
  ].join("\n");
  const embedded = serials(text);
  const candidates = embedded.length ? embedded : serials(filename);
  if (candidates.length !== 1)
    throw Error(
      candidates.length
        ? "Multiple serials found. Keep one LWV serial in the Standard file information."
        : "No LWV serial found. Embed it in image metadata or include it in the Standard filename.",
    );
  return { serial: candidates[0], source: embedded.length ? "metadata" : "filename" };
}
