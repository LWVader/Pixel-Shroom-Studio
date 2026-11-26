const filenames = new Set([
  "orbit-roast.webp", "orbit-roast-640.webp", "boom-bun.webp",
  "mossbyte.webp", "static-bloom.webp", "midnight-sole.webp"
]);

const serviceFilenames = new Set([
  "solar-dunes.webp", "emerald-mist.webp", "arcade-wave.webp", "alpine-dawn.webp",
  "velvet-rose.webp", "neon-underpass.webp", "paper-architecture.webp", "celestial-drift.webp",
  "citrus-splash.webp", "ink-and-sun.webp", "ember-orbit.webp"
]);
const legacyServiceDirectory = "/assets/service-examples/";

export const legacyArtworkDirectory = "/assets/campaigns/";

export function exampleArtworkPath(legacyPath) {
  if (legacyPath.startsWith(legacyServiceDirectory)) {
    const filename = legacyPath.slice(legacyServiceDirectory.length);
    return serviceFilenames.has(filename) ? `/assets/service-previews/${filename}` : null;
  }
  if (!legacyPath.startsWith(legacyArtworkDirectory)) return null;
  const filename = legacyPath.slice(legacyArtworkDirectory.length);
  return filenames.has(filename) ? `/assets/campaign-examples/${filename}` : null;
}
