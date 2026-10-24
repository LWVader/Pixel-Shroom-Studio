// Studio-approved Gelato product UIDs supplied by the owner.
export const CANVAS_TAX_CODE = "txcd_99999999"; // Stripe: General - Tangible Goods.
const framedUid = (size, finish) =>
  `framed_canvas_geo_simplified_${size === 16 ? "400x600-mm-16x24-inch" : "600x600-mm-24x24-inch"}_${finish}_${size === 16 ? "452x652-mm-18x26-inch" : "652x652-mm-26x26-inch"}_wood-fsc-slim_ver_wood_w14xt42-mm_canvas_4-0`;
export const GELATO_PRODUCT_OPTIONS = [
  {
    uid: "canvas_400x400-mm-16x16-inch_canvas_wood-fsc-thick_4-0_ver",
    label: "16 × 16 · Thick canvas · Unframed",
    tiers: ["Standard", "Silver", "Gold"],
    frame: "none",
  },
  ...[16, 24].flatMap((size) =>
    [
      ["black", "black", "Black"],
      ["natural", "natural-wood", "Natural"],
      ["dark-wood", "dark-wood", "Dark Wood"],
    ].map(([frame, finish, label]) => ({
      uid: framedUid(size, finish),
      label: `${size === 16 ? "16 × 24 portrait" : "24 × 24"} · ${label} frame`,
      tiers: size === 16 ? ["Emerald", "Sapphire"] : ["Prismatic"],
      frame,
    })),
  ),
];
export const optionsForTier = (tier) =>
  GELATO_PRODUCT_OPTIONS.filter((option) => option.tiers.includes(tier));
