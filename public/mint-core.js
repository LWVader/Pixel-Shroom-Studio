export const FOIL_TIERS = ["Standard", "Silver", "Gold", "Emerald", "Sapphire", "Prismatic"];
export const SIX_TIER_RATES = Object.freeze({
  Standard: 60,
  Silver: 20,
  Gold: 10,
  Emerald: 6,
  Sapphire: 3,
  Prismatic: 1,
});
export const LEGACY_FOIL_RATES = Object.freeze({ Standard: 70, Silver: 20, Gold: 9, Prismatic: 1 });
export function canonicalMintPayload(payload) {
  return JSON.stringify(
    Object.fromEntries(
      Object.keys(payload)
        .sort()
        .map((key) => [key, payload[key]]),
    ),
  );
}
export function editionDisclosure(edition) {
  const rates =
    edition.dropRates || (edition.rulesVersion === 2 ? SIX_TIER_RATES : LEGACY_FOIL_RATES);
  const tiers = FOIL_TIERS.filter((tier) => Number(rates[tier]) > 0);
  const odds = tiers.map((tier) => `${tier} ${Number(rates[tier])}%`).join(", ");
  const caps = tiers
    .filter((tier) => tier !== "Standard")
    .map((tier) => `${tier} ${Number(edition[tier.toLowerCase() + "Cap"] || 0)}`)
    .join(", ");
  return `Initial rolls: ${odds}. Caps: ${caps}. Exhausted tiers downgrade ${[...tiers].reverse().join(" → ")}; probabilities change as caps fill. One paid purchase produces one numbered digital variant. No blockchain token, resale value or financial return is promised.`;
}
export function safeMintImage(value, supabaseUrl) {
  try {
    const url = new URL(value);
    const base = new URL(supabaseUrl);
    if (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.origin === base.origin &&
      url.pathname.startsWith("/storage/v1/object/sign/minted/")
    )
      return url.href;
  } catch {}
  throw new Error("Invalid private mint delivery URL.");
}
