// Resolution-independent foil layers. Geometry is seeded for repeatable rendering;
// this visual seed never chooses a rarity or changes an allocated tier.
import { createHash } from "node:crypto";
const spectrum = `<stop stop-color="#a7eaff"/><stop offset=".18" stop-color="#f7acd9"/><stop offset=".36" stop-color="#fff4a8"/><stop offset=".54" stop-color="#9ff3d2"/><stop offset=".73" stop-color="#bdb2f8"/><stop offset="1" stop-color="#ffb9cb"/>`;
export function prismaticLayers(width, height, seed) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
    throw new Error("Invalid Prismatic dimensions");
  const hash = createHash("sha256").update(String(seed)).digest();
  const unit = Math.min(width, height);
  const edge = Math.max(0.4, unit * 0.014);
  const margin = unit * 0.024;
  const radius = unit * 0.039;
  const root = (content) =>
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`,
    );
  const sheen = root(`<defs>
    <linearGradient id="rainbow" x1="0" y1="1" x2="1" y2="0">${spectrum}</linearGradient>
    <linearGradient id="bands" x1="0" y1="0" x2="1" y2=".8"><stop stop-color="#27d9ff" stop-opacity=".24"/><stop offset=".25" stop-color="#ff4fcd" stop-opacity=".22"/><stop offset=".42" stop-color="#fff38a" stop-opacity=".08"/><stop offset=".63" stop-color="#26e8cc" stop-opacity=".24"/><stop offset=".81" stop-color="#ab75ff" stop-opacity=".2"/><stop offset="1" stop-color="#ff61ce" stop-opacity=".2"/></linearGradient>
    </defs><rect width="100%" height="100%" fill="url(#rainbow)" opacity=".05"/><rect width="100%" height="100%" fill="url(#bands)"/>`);
  const flares = [];
  for (let i = 0; i < 13; i++) {
    const x = width * (0.08 + (hash[(i * 2) % 32] / 255) * 0.84);
    const y = height * (0.09 + (hash[(i * 2 + 1) % 32] / 255) * 0.82);
    const length = unit * (0.035 + (hash[(i + 7) % 32] / 255) * 0.065);
    const angle = -35 + (hash[(i + 12) % 32] / 255) * 16;
    flares.push(`<g transform="translate(${x} ${y}) rotate(${angle})">
      <ellipse rx="${length}" ry="${length * 0.13}" fill="url(#flare)" opacity=".55"/><ellipse rx="${length * 0.85}" ry="${length * 0.055}" fill="url(#rainbow)" mask="url(#fade)" opacity=".8"/>
      <path d="M${-length} 0H${length}" stroke="url(#rainbow)" stroke-width="${Math.max(0.5, unit * 0.002)}" opacity=".7"/>
      <path d="M0 ${-length * 0.3}L${length * 0.045} ${-length * 0.035}L${length * 0.4} 0L${length * 0.045} ${length * 0.035}L0 ${length * 0.3}L${-length * 0.045} ${length * 0.035}L${-length * 0.4} 0L${-length * 0.045} ${-length * 0.035}Z" fill="#fff9e1" opacity=".65"/>
    </g>`);
  }
  const diffraction = root(
    `<defs><linearGradient id="rainbow">${spectrum}</linearGradient><radialGradient id="fade-gradient"><stop stop-color="white"/><stop offset="1" stop-color="black"/></radialGradient><mask id="fade" maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill="url(#fade-gradient)"/></mask><radialGradient id="flare"><stop stop-color="#ffffff" stop-opacity=".65"/><stop offset=".2" stop-color="#eac9ff" stop-opacity=".45"/><stop offset=".5" stop-color="#73eaff" stop-opacity=".3"/><stop offset="1" stop-color="#ffd477" stop-opacity="0"/></radialGradient></defs>${flares.join("")}`,
  );
  const frame = [];
  // Nested dark bevels and narrow highlights keep the rainbow frame dimensional.
  for (const [offset, stroke, strokeWidth, opacity] of [
    [margin, "#171426", edge * 2.8, 0.8],
    [margin, "url(#rainbow)", edge * 1.8, 1],
    [margin - edge * 0.85, "#fff5dd", edge * 0.17, 0.9],
    [margin + edge * 1.4, "#272237", edge * 0.8, 0.8],
    [margin + edge * 1.4, "url(#rainbow)", edge * 0.38, 1],
    [margin + edge * 2.1, "#fff4e7", edge * 0.16, 0.8],
  ])
    frame.push(
      `<rect x="${offset}" y="${offset}" width="${Math.max(0.1, width - 2 * offset)}" height="${Math.max(0.1, height - 2 * offset)}" rx="${unit * 0.008}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}"/>`,
    );
  // The reference's corner rosettes become universal holographic medallions.
  for (const [cx, cy] of [
    [margin * 1.8, margin * 1.8],
    [width - margin * 1.8, margin * 1.8],
    [margin * 1.8, height - margin * 1.8],
    [width - margin * 1.8, height - margin * 1.8],
  ]) {
    const petals = [];
    for (let i = 0; i < 8; i++)
      petals.push(
        `<path d="M0 0Q${radius * 0.85} ${-radius * 0.6} ${radius} 0Q${radius * 0.35} ${radius * 0.65} 0 0Z" fill="${["#a5e8ef", "#f3aed8", "#fff0a6", "#b5a7ed"][i % 4]}" stroke="#fff6dd" stroke-width="${radius * 0.035}" transform="rotate(${i * 45})"/>`,
      );
    frame.push(
      `<g transform="translate(${cx} ${cy})"><circle r="${radius * 1.13}" fill="#292438" stroke="url(#rainbow)" stroke-width="${edge * 0.5}"/><circle r="${radius}" fill="#f2dce7"/>${petals.join("")}<circle r="${radius * 0.12}" fill="#fff8dc"/></g>`,
    );
  }
  // Small facets along the rails adapt to portraits, landscapes and square masters.
  for (let i = 1; i < 11; i++) {
    const t = i / 11;
    for (const [x, y] of [
      [width * t, margin],
      [width * t, height - margin],
      [margin, height * t],
      [width - margin, height * t],
    ]) {
      if ((x < radius * 3 || x > width - radius * 3) && (y < radius * 3 || y > height - radius * 3))
        continue;
      const r = unit * 0.0045;
      frame.push(
        `<path d="M${x} ${y - r * 1.6}L${x + r} ${y}L${x} ${y + r * 1.6}L${x - r} ${y}Z" fill="${i % 2 ? "#fff2af" : "#b3f4ec"}" stroke="#fff9ec" stroke-width="${r * 0.2}"/>`,
      );
    }
  }
  return [
    { input: sheen, blend: "over" },
    { input: diffraction, blend: "screen" },
    {
      input: root(
        `<defs><linearGradient id="rainbow" x1="0" y1="0" x2="1" y2="1">${spectrum}</linearGradient></defs>${frame.join("")}`,
      ),
      blend: "over",
    },
  ];
}
