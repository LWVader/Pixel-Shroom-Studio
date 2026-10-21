// Reference-inspired metal and gemstone layers, fitted to the source dimensions.
import { createHash } from "node:crypto";
const PALETTES = {
  Silver: { low: "#424a58", mid: "#b8c6d6", high: "#f9fdff", trim: "#d4dfec" },
  Gold: { low: "#75420d", mid: "#d6a333", high: "#fff0ad", trim: "#f1cf72" },
  Emerald: { low: "#032c20", mid: "#07945b", high: "#8cf5ba", trim: "#e2c77c" },
  Sapphire: { low: "#0b154a", mid: "#225cc5", high: "#9ce9ff", trim: "#d7b96f" },
};
export function finishLayers(width, height, tier, seed) {
  const palette = PALETTES[tier];
  if (
    !palette ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1
  )
    throw new Error("Invalid tier finish dimensions");
  const gem = tier === "Emerald" || tier === "Sapphire";
  const hash = createHash("sha256").update(String(seed)).digest();
  const unit = Math.min(width, height),
    rail = unit * 0.026,
    inset = unit * 0.028;
  const svg = (content) =>
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`,
    );
  const defs = `<defs>
    <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${palette.high}"/><stop offset=".18" stop-color="${palette.low}"/><stop offset=".35" stop-color="${palette.mid}"/><stop offset=".47" stop-color="${palette.high}"/><stop offset=".58" stop-color="${palette.low}"/><stop offset=".83" stop-color="${palette.mid}"/><stop offset="1" stop-color="${palette.high}"/></linearGradient>
    <linearGradient id="surface" x1="0" y1="0" x2="1" y2=".7"><stop stop-color="${palette.mid}" stop-opacity=".14"/><stop offset=".28" stop-color="${palette.high}" stop-opacity=".06"/><stop offset=".4" stop-color="${palette.high}" stop-opacity=".22"/><stop offset=".43" stop-color="${palette.low}" stop-opacity=".08"/><stop offset=".67" stop-color="${palette.mid}" stop-opacity=".14"/><stop offset=".79" stop-color="${palette.high}" stop-opacity=".2"/><stop offset="1" stop-color="${palette.mid}" stop-opacity=".1"/></linearGradient>
    <radialGradient id="jewel"><stop stop-color="${palette.high}"/><stop offset=".55" stop-color="${palette.mid}"/><stop offset="1" stop-color="${palette.low}"/></radialGradient>
  </defs>`;
  const surface = [`<rect width="100%" height="100%" fill="url(#surface)"/>`];
  if (gem) {
    // Triangulated facets provide a crystalline finish without replacing the subject.
    for (let y = 0; y < 7; y++)
      for (let x = 0; x < 7; x++) {
        const left = (x * width) / 7,
          top = (y * height) / 7,
          w = width / 7,
          h = height / 7;
        const k = (x + y * 7) % 32,
          alpha = 0.045 + (hash[k] / 255) * 0.08;
        surface.push(
          `<path d="M${left} ${top}L${left + w} ${top}L${left + w * 0.44} ${top + h}Z" fill="${palette.high}" opacity="${alpha}"/><path d="M${left} ${top}L${left + w * 0.44} ${top + h}L${left} ${top + h}Z" fill="${palette.mid}" opacity="${alpha}"/>`,
        );
      }
  }
  const frame = [];
  for (const [offset, stroke, weight] of [
    [inset, palette.low, rail * 2.4],
    [inset, "url(#metal)", rail * 1.9],
    [inset - rail * 0.9, palette.high, unit * 0.002],
    [inset + rail * 1.25, palette.low, unit * 0.006],
    [inset + rail * 1.35, palette.trim, unit * 0.003],
    [inset + rail * 1.6, palette.high, unit * 0.0018],
  ]) {
    frame.push(
      `<rect x="${offset}" y="${offset}" width="${Math.max(0.1, width - 2 * offset)}" height="${Math.max(0.1, height - 2 * offset)}" rx="${unit * 0.007}" fill="none" stroke="${stroke}" stroke-width="${weight}"/>`,
    );
  }
  function jewel(cx, cy, r, angle = 0) {
    return `<g transform="translate(${cx} ${cy}) rotate(${angle})"><ellipse rx="${r * 1.04}" ry="${r * 1.3}" fill="${palette.trim}"/><path d="M${-r * 0.7} ${-r * 0.72}L0 ${-r * 1.2}L${r * 0.75} ${-r * 0.65}L${r} ${r * 0.3}L${r * 0.5} ${r * 1.05}L${-r * 0.55} ${r * 1.02}L${-r} ${-r * 0.05}Z" fill="url(#jewel)" stroke="${palette.high}" stroke-width="${r * 0.04}"/><path d="M${-r * 0.7} ${-r * 0.72}L${r * 0.35} ${-r * 0.4}L0 ${r * 0.6}Z" fill="${palette.high}" opacity=".7"/><path d="M${r * 0.75} ${-r * 0.65}L${r * 0.35} ${-r * 0.4}L0 ${r * 0.6}L${r * 0.5} ${r * 1.05}L${r} ${r * 0.3}Z" fill="${palette.low}" opacity=".7"/><path d="M${-r} ${-r * 0.05}L0 ${r * 0.6}L${-r * 0.55} ${r * 1.02}Z" fill="${palette.mid}"/></g>`;
  }
  // Filigree rails repeat at a consistent physical scale on every aspect ratio.
  function railDecor(length, transform) {
    const segments = Math.max(2, Math.min(32, Math.floor(length / (unit * 0.14))));
    const parts = [];
    for (let i = 1; i < segments; i++) {
      const x = (length * i) / segments,
        r = unit * 0.012;
      parts.push(
        `<g transform="translate(${x} 0)"><path d="M${-r * 3} 0C${-r * 2} ${-r * 2.6} ${r * 2.5} ${-r * 2} ${r * 1.8} ${r * 0.4}C${r * 1.1} ${r * 2} ${-r * 0.8} ${r * 0.7} 0 0" fill="none" stroke="${palette.low}" stroke-width="${r * 0.65}"/><path d="M${-r * 3} 0C${-r * 2} ${-r * 2.6} ${r * 2.5} ${-r * 2} ${r * 1.8} ${r * 0.4}C${r * 1.1} ${r * 2} ${-r * 0.8} ${r * 0.7} 0 0" fill="none" stroke="${palette.trim}" stroke-width="${r * 0.3}"/></g>`,
      );
      if (gem && i % 2 === 0) parts.push(jewel(x, 0, unit * 0.012, (i % 3) * 25));
    }
    return `<g transform="${transform}">${parts.join("")}</g>`;
  }
  frame.push(
    railDecor(width, `translate(0 ${inset})`),
    railDecor(width, `translate(0 ${height - inset})`),
    railDecor(height, `translate(${inset} 0) rotate(90)`),
    railDecor(height, `translate(${width - inset} 0) rotate(90)`),
  );
  for (const [cx, cy, angle] of [
    [unit * 0.046, unit * 0.046, -35],
    [width - unit * 0.046, unit * 0.046, 35],
    [unit * 0.046, height - unit * 0.046, 35],
    [width - unit * 0.046, height - unit * 0.046, -35],
  ]) {
    if (gem) frame.push(jewel(cx, cy, unit * 0.035, angle));
    else {
      const petals = [];
      for (let i = 0; i < 9; i++)
        petals.push(
          `<path d="M0 0C${unit * 0.035} ${-unit * 0.036} ${unit * 0.049} ${unit * 0.02} 0 0Z" fill="url(#metal)" stroke="${palette.trim}" stroke-width="${unit * 0.001}" transform="rotate(${i * 40})"/>`,
        );
      frame.push(
        `<g transform="translate(${cx} ${cy})"><circle r="${unit * 0.04}" fill="${palette.low}" stroke="url(#metal)" stroke-width="${unit * 0.004}"/>${petals.join("")}</g>`,
      );
    }
  }
  const glints = [];
  for (let i = 0; i < 8; i++) {
    const x = width * (0.08 + (hash[(i + 8) % 32] / 255) * 0.84),
      y = height * (0.08 + (hash[(i + 17) % 32] / 255) * 0.84),
      r = unit * (gem ? 0.018 : 0.012);
    glints.push(
      `<path d="M${x - r} ${y}L${x - r * 0.1} ${y - r * 0.1}L${x} ${y - r}L${x + r * 0.1} ${y - r * 0.1}L${x + r} ${y}L${x + r * 0.1} ${y + r * 0.1}L${x} ${y + r}L${x - r * 0.1} ${y + r * 0.1}Z" fill="${palette.high}" opacity=".7"/>`,
    );
  }
  return [
    { input: svg(defs + surface.join("")), blend: "over" },
    { input: svg(defs + frame.join("") + glints.join("")), blend: "over" },
  ];
}
