export const FOIL_TIERS = ["Standard", "Silver", "Gold", "Prismatic"];
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
  return `Initial rolls: Standard 70%, Silver 20%, Gold 9%, Prismatic 1%. Caps: Silver ${edition.silverCap}, Gold ${edition.goldCap}, Prismatic ${edition.prismaticCap}. Exhausted tiers downgrade Prismatic → Gold → Silver → Standard; probabilities change as caps fill. One paid purchase produces one numbered digital variant. No blockchain token, resale value or financial return is promised.`;
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
