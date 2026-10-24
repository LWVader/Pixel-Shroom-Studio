// One product policy shared by the admin, storefront and private print API.
export const FRAME_OPTIONS = { black: "Black", natural: "Natural", "dark-wood": "Dark Wood" };
export function canvasProduct(tier, frame = "none") {
  if (!["Standard", "Silver", "Gold", "Emerald", "Sapphire", "Prismatic"].includes(tier))
    throw Error("Select an artwork tier.");
  const framed = ["Emerald", "Sapphire", "Prismatic"].includes(tier);
  if (framed && !Object.hasOwn(FRAME_OPTIONS, frame))
    throw Error("Choose Black, Natural or Dark Wood framing.");
  const size = tier === "Prismatic" ? 24 : 16;
  const height = ["Emerald", "Sapphire"].includes(tier) ? 24 : size;
  return {
    size,
    width: size,
    height,
    frame: framed ? frame : "none",
    framed,
    label: framed
      ? `${size} × ${height}${height !== size ? " portrait" : ""} canvas · ${FRAME_OPTIONS[frame]} frame`
      : "16 × 16 thick canvas, unframed",
    specs: {
      width: size,
      height,
      bleedMm: 0,
      wrapMm: 0,
      safeMm: 4,
      minimumDpi: 150,
      transparent: false,
      templateUrl: "https://dashboard.gelato.com/catalogue/categories",
    },
  };
}
