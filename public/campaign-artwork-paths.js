const filenames = new Set([
  "orbit-roast.webp", "orbit-roast-640.webp", "boom-bun.webp",
  "mossbyte.webp", "static-bloom.webp", "midnight-sole.webp"
]);

export const legacyArtworkDirectory = "/assets/campaigns/";

export function exampleArtworkPath(legacyPath) {
  if (!legacyPath.startsWith(legacyArtworkDirectory)) return null;
  const filename = legacyPath.slice(legacyArtworkDirectory.length);
  return filenames.has(filename) ? `/assets/campaign-examples/${filename}` : null;
}
