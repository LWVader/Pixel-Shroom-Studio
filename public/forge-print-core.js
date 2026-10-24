// Presentation prices; the server owns all authorization, prices and inventory.
export const PLANNED_OFFERS = {
  canvas: { name: "Canvas Mystery Roll", price: 69, shipping: 13.49, count: 1 },
  digital: { name: "Single Digital Roll", price: 8, shipping: 0, count: 1 },
  three: { name: "3-Roll Forge Pack", price: 21, shipping: 0, count: 3 },
  five: { name: "5-Roll Forge Pack", price: 32, shipping: 0, count: 5 },
  ten: { name: "10-Roll Hunt Bundle", price: 59, shipping: 0, count: 10 },
};
export const TIER_FINISHES = [
  {
    tier: "Standard",
    odds: 60,
    finish: "16 × 16 thick canvas, unframed",
    detail: "The Standard studio-uploaded image. Thick gallery canvas profile.",
  },
  {
    tier: "Silver",
    odds: 20,
    finish: "16 × 16 thick canvas, unframed",
    detail: "The Silver studio-uploaded image. Same physical format as Standard.",
  },
  {
    tier: "Gold",
    odds: 10,
    finish: "16 × 16 thick canvas, unframed",
    detail: "The Gold image on the same thick gallery canvas format as Standard and Silver.",
  },
  {
    tier: "Emerald",
    odds: 6,
    finish: "16 × 24 portrait canvas · Black, Natural or Dark Wood frame",
    detail: "The Emerald image with your choice of Black, Natural or Dark Wood framing.",
  },
  {
    tier: "Sapphire",
    odds: 3,
    finish: "16 × 24 portrait canvas · Black, Natural or Dark Wood frame",
    detail: "The Sapphire image with your choice of Black, Natural or Dark Wood framing.",
  },
  {
    tier: "Prismatic",
    odds: 1,
    finish: "24 × 24 canvas · Black, Natural or Dark Wood frame",
    detail:
      "The Prismatic image on a larger 24 × 24 canvas, with your choice of Black, Natural or Dark Wood framing.",
  },
];
export const FORGE_RECIPES = [
  { from: "Standard", quantity: 5, to: "Silver" },
  { from: "Silver", quantity: 3, to: "Gold" },
  { from: "Gold", quantity: 3, to: "Emerald" },
  { from: "Emerald", quantity: 2, to: "Sapphire" },
  { from: "Sapphire", quantity: 2, to: "Prismatic" },
];
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
export const artUrl = (id, offer) =>
  `/art.html?id=${encodeURIComponent(id)}${offer && Object.hasOwn(PLANNED_OFFERS, offer) ? `&offer=${offer}` : ""}`;
export const money = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
export function rollPaths(row) {
  if (row.category === "NFT") return "";
  return `<div class="roll-paths"><p class="offer-state">Roll → Reveal → Forge or Print</p>
    <a class="button" href="${artUrl(row.id, "canvas")}">Canvas + Digital — $69 <span>+$13.49 shipping · US only</span></a>
    <a class="button secondary" href="${artUrl(row.id, "digital")}">Digital Roll — $8 <span>Collect · Forge · print later</span></a></div>`;
}
export function tierShowcase() {
  return `<div class="tier-showcase"><div class="tier-selector" role="group" aria-label="Explore tier finishes">${TIER_FINISHES.map((t, i) => `<button type="button" data-tier-finish="${t.tier}" aria-pressed="${i === 0}"><strong>${t.odds}% ${t.tier}</strong><span>${escape(t.finish)}</span><meter min="0" max="100" value="${t.odds}" aria-label="${t.tier} base odds">${t.odds}%</meter></button>`).join("")}</div>
    <article class="tier-focus" aria-live="polite"><p class="eyebrow">Associated canvas finish</p><h3 id="finish-title">Standard · 60%</h3><p id="finish-format">${TIER_FINISHES[0].finish}</p><p id="finish-description">${TIER_FINISHES[0].detail}</p><a class="text-link" href="/canvas-specs.html">See sizing and print details →</a></article></div>`;
}
export function forgeEstimate(tier, count) {
  const recipe = FORGE_RECIPES.find((r) => r.from === tier);
  if (!recipe || !Number.isSafeInteger(count) || count < 0 || count > 100000)
    throw Error("Choose a valid tier and whole image count.");
  return {
    ...recipe,
    outputs: Math.floor(count / recipe.quantity),
    remaining: count % recipe.quantity,
  };
}
export function offerSummary(key) {
  const p = PLANNED_OFFERS[key];
  if (!p) throw Error("Unknown offer");
  return `${money(p.price)}${p.shipping ? ` + ${money(p.shipping)} shipping = ${money(p.price + p.shipping)}` : ""} before applicable tax`;
}
export const safeArtworkId = (value) =>
  /^\d{1,15}$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
export function readSelections(storage) {
  try {
    const rows = JSON.parse(storage.getItem("pixel-shroom-selections-v1") || "[]");
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((x) => x && safeArtworkId(x.artworkId) && Object.hasOwn(PLANNED_OFFERS, x.offer))
      .slice(0, 20)
      .map((x) => ({ artworkId: String(x.artworkId), offer: x.offer }));
  } catch {
    return [];
  }
}
export function writeSelections(storage, rows) {
  storage.setItem(
    "pixel-shroom-selections-v1",
    JSON.stringify(
      rows.slice(0, 20).map((x) => ({ artworkId: String(x.artworkId), offer: x.offer })),
    ),
  );
}
