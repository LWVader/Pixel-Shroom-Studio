// Shared by the owner UI and Edge Function. No file is sent to Gelato by this checker.
export const SIZE_PRESETS = {
  card: [5, 7],
  small: [8, 10],
  medium: [11, 14],
  shirt: [12, 16],
  poster: [18, 24],
  large: [24, 36],
  mug: [8.5, 3.5],
};
export function inspectPrintBytes(buffer) {
  const bytes = new Uint8Array(buffer),
    view = new DataView(buffer);
  const text = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length < 24) throw Error("The print file is empty or incomplete.");
  let facts = { bytes: bytes.length, width: 0, height: 0, alphaChannel: false, profile: "unknown" };
  if (text(0, 8) === "\x89PNG\r\n\x1a\n") {
    facts = { ...facts, format: "png", width: view.getUint32(16), height: view.getUint32(20) };
    let offset = 8,
      end = false;
    while (offset + 12 <= bytes.length) {
      const size = view.getUint32(offset),
        type = text(offset + 4, offset + 8);
      if (size > bytes.length - offset - 12) throw Error("Incomplete PNG chunk.");
      if (type === "IHDR") {
        if (size !== 13) throw Error("Invalid PNG header.");
        facts.bitDepth = bytes[offset + 16];
        facts.colorType = bytes[offset + 17];
        facts.alphaChannel = [4, 6].includes(facts.colorType);
      }
      if (type === "tRNS") facts.alphaChannel = true;
      if (type === "sRGB") facts.profile = "sRGB marker";
      if (type === "iCCP") facts.profile = "embedded ICC (manual profile review required)";
      offset += size + 12;
      if (type === "IEND") {
        end = true;
        break;
      }
    }
    if (!end) throw Error("PNG has no complete end marker.");
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    facts.format = "jpg";
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) throw Error("Invalid JPEG marker.");
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 218 || marker === 217) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) throw Error("Incomplete JPEG segment.");
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        facts.height = view.getUint16(offset + 3);
        facts.width = view.getUint16(offset + 5);
        facts.components = bytes[offset + 7];
      }
      if (marker === 226 && text(offset + 2, offset + 14) === "ICC_PROFILE\0")
        facts.profile = "embedded ICC (manual profile review required)";
      offset += length;
    }
    if (bytes.at(-2) !== 255 || bytes.at(-1) !== 217)
      throw Error("JPEG has no complete end marker.");
  } else if (text(0, 5) === "%PDF-") {
    facts.format = "pdf";
  } else
    throw Error("Use an actual PNG, JPEG or PDF; renaming an extension does not convert a file.");
  if (
    facts.format !== "pdf" &&
    (!facts.width || !facts.height || facts.width * facts.height > 100000000)
  )
    throw Error("Invalid dimensions or more than 100 million pixels.");
  return facts;
}
export function normalizeSpecs(value = {}) {
  const s = {};
  for (const key of ["width", "height", "bleedMm", "wrapMm", "safeMm", "minimumDpi"])
    s[key] = Number(value[key]);
  if (
    ![s.width, s.height].every((n) => Number.isFinite(n) && n > 0 && n <= 200) ||
    ![s.bleedMm, s.wrapMm, s.safeMm].every((n) => Number.isFinite(n) && n >= 0 && n <= 100) ||
    ![150, 300].includes(s.minimumDpi)
  )
    throw Error("Enter valid product dimensions, margins and minimum resolution.");
  const link = new URL(value.templateUrl);
  if (
    link.protocol !== "https:" ||
    link.username ||
    link.password ||
    !(link.hostname === "gelato.com" || link.hostname.endsWith(".gelato.com"))
  )
    throw Error("Use the selected product’s HTTPS Gelato template or catalogue link.");
  s.templateUrl = link.href;
  s.transparent = value.transparent === true;
  return s;
}
export function evaluatePrint(facts, input) {
  const specs = normalizeSpecs(input),
    errors = [],
    warnings = [];
  const widthIn = specs.width + (2 * (specs.bleedMm + specs.wrapMm)) / 25.4;
  const heightIn = specs.height + (2 * (specs.bleedMm + specs.wrapMm)) / 25.4;
  const target = [Math.ceil(widthIn * 300), Math.ceil(heightIn * 300)];
  const minimum = [Math.ceil(widthIn * specs.minimumDpi), Math.ceil(heightIn * specs.minimumDpi)];
  let dpi = null;
  if (facts.bytes > 104857600) errors.push("File exceeds this store’s 100 MB limit.");
  if (facts.format === "pdf") {
    warnings.push(
      "PDF dimensions, page count, embedded image PPI, fonts, output intent and PDF/X-4 compliance require external preflight. They are not measured here.",
    );
    errors.push(
      "PDF cannot be approved by the automatic checker. Use a print-ready PNG or JPEG for this workflow.",
    );
  } else {
    dpi = Math.min(facts.width / widthIn, facts.height / heightIn);
    if (facts.width < minimum[0] || facts.height < minimum[1])
      errors.push(`Resolution is below ${specs.minimumDpi} PPI for this full print area.`);
    if (Math.abs(facts.width / facts.height / (widthIn / heightIn) - 1) > 0.01)
      errors.push(
        "Artwork aspect ratio differs by more than 1%. Export to the exact template; no automatic crop or stretch is applied.",
      );
    if (dpi < 300)
      warnings.push(
        "Below the recommended 300 PPI. Confirm the product permits this and inspect a sample.",
      );
    if (facts.components === 4)
      errors.push("CMYK JPEG detected. Export an sRGB raster file for this workflow.");
    if (specs.transparent && (facts.format !== "png" || !facts.alphaChannel))
      errors.push("Transparent-background products require a PNG with transparency support.");
    if (
      specs.transparent &&
      facts.format === "png" &&
      (facts.bitDepth !== 8 || ![2, 6].includes(facts.colorType))
    )
      errors.push(
        "Export transparent artwork as an 8-bit-per-channel RGB/RGBA PNG (PNG-24/32), not indexed or grayscale PNG.",
      );
    if (facts.profile !== "sRGB marker")
      warnings.push(
        "sRGB was not certified automatically. Check the export profile in your design application.",
      );
  }
  if (specs.safeMm * 2 >= Math.min(specs.width, specs.height) * 25.4)
    errors.push("Safe margin leaves no usable design area.");

  return {
    version: 2,
    state: errors.length ? "blocked" : "ready",
    specs,
    target,
    minimum,
    widthIn,
    heightIn,
    dpi,
    errors,
    warnings,
    assurance: "Automated technical checks only; not Gelato production approval.",
  };
}
