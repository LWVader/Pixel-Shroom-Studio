import {industries} from "../public/industries.js";

import {MAX_PREVIEW_BASE64} from "../public/campaign-preview.js";

const publicView = "published = 1 AND image_preview_webp IS NOT NULL";
const columns = "id, name, sector, tagline, brief, creative_value, image_alt, palette, published, version, updated_at, image_preview_webp IS NOT NULL AS preview_ready";
export const campaignIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

function clean(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function urls(row, admin) {
  const {creative_value: value, image_alt: alt, palette, preview_ready, ...item} = row;
  return {...item, value, alt, previewReady: Boolean(preview_ready), colors: palette ? palette.split(",") : [],
    sharePath: `/campaigns/${item.id}`,
    imageUrl: `${admin ? "/api/admin/portfolio" : "/api/portfolio"}/${item.id}/image?v=${item.version}`};
}

function validImage(base64, limit = 1_100_000) {
  if (typeof base64 !== "string" || base64.length < 28 || base64.length > limit ||
      base64.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return false;
  try {
    const head = atob(base64.slice(0, 24));
    if (head.slice(0, 4) !== "RIFF" || head.slice(8, 12) !== "WEBP") return false;
    return head.slice(12, 16) === "VP8 " || head.slice(12, 16) === "VP8L" || head.slice(12, 16) === "VP8X";
  } catch {
    return false;
  }
}

export async function portfolioList(db, offset, admin) {
  const {results} = await db.prepare(
    `SELECT ${columns} FROM portfolio_campaigns ${admin ? "" : `WHERE ${publicView}`}
     ORDER BY updated_at DESC, id LIMIT 25 OFFSET ?`
  ).bind(offset).all();
  return {campaigns: results.slice(0, 24).map((row) => urls(row, admin)), more: results.length > 24};
}

export async function portfolioItem(db, id) {
  if (!campaignIdPattern.test(id ?? "")) return null;
  const row = await db.prepare(`SELECT ${columns} FROM portfolio_campaigns WHERE id = ? AND ${publicView}`).bind(id).first();
  return row ? urls(row, false) : null;
}

export async function portfolioImage(db, id, admin) {
  if (!campaignIdPattern.test(id)) return null;
  const row = await db.prepare(
    `SELECT ${admin ? "image_webp" : "image_preview_webp"} AS image_webp
      FROM portfolio_campaigns WHERE id = ? ${admin ? "" : `AND ${publicView}`}`
  ).bind(id).first();
  return row ? Uint8Array.from(atob(row.image_webp), (char) => char.charCodeAt(0)) : null;
}

export async function savePortfolio(db, input) {
  const {id, version, sector, image, preview, published} = input ?? {};
  const name = clean(input?.name, 100), tagline = clean(input?.tagline, 160);
  const brief = clean(input?.brief, 600), value = clean(input?.value, 800), alt = clean(input?.alt, 160);
  const colors = clean(input?.palette, 60).split(/[\s,]+/).filter(Boolean).map((color) => color.toUpperCase());
  if (typeof id !== "string" || !campaignIdPattern.test(id) || !Number.isSafeInteger(version) || version < 0 ||
      typeof sector !== "string" || !Object.hasOwn(industries, sector) ||
      typeof published !== "boolean" || !name || !tagline || !brief || !value || !alt ||
      colors.length > 5 || colors.some((color) => !/^#[0-9A-F]{6}$/.test(color))) {
    throw {error: "Complete the campaign fields and use up to five hex colors.", status: 400};
  }
  if ((version === 0 || image != null) && !validImage(image)) {
    throw {error: "Upload a valid campaign WebP image under 800 KB.", status: 400};
  }
  if (image != null && (!validImage(preview, MAX_PREVIEW_BASE64) || preview === image)) {
    throw {error: "A separate, protected WebP preview is required for the uploaded artwork.", status: 400};
  }
  if (image == null && preview != null) {
    throw {error: "Upload artwork or use the existing-preview protection action.", status: 400};
  }
  const now = new Date().toISOString();
  const values = [name, sector, tagline, brief, value, alt, colors.join(","), image ?? null, preview ?? null, +published, now];
  const row = version === 0
    ? await db.prepare(`INSERT INTO portfolio_campaigns
        (name,sector,tagline,brief,creative_value,image_alt,palette,image_webp,image_preview_webp,published,updated_at,id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING RETURNING ${columns}`)
      .bind(...values, id).first()
    : await db.prepare(`UPDATE portfolio_campaigns SET name=?,sector=?,tagline=?,brief=?,creative_value=?,
        image_alt=?,palette=?,image_webp=COALESCE(?,image_webp),image_preview_webp=COALESCE(?,image_preview_webp),published=?,updated_at=?,version=version+1
        WHERE id=? AND version=? RETURNING ${columns}`).bind(...values, id, version).first();
  if (!row) throw {error: "This campaign changed. Refresh before saving again.", status: 409};
  return urls(row, true);
}


export async function protectPortfolioPreview(db, input) {
  const {id, version, preview} = input ?? {};
  if (typeof id !== "string" || !campaignIdPattern.test(id) || !Number.isSafeInteger(version) ||
      !validImage(preview, MAX_PREVIEW_BASE64)) {
    throw {error: "A valid protected WebP preview is required.", status: 400};
  }
  // Keep presentation order stable while rebuilding previews in batches.
  const row = await db.prepare(`UPDATE portfolio_campaigns
    SET image_preview_webp = ?, version = version + 1
    WHERE id = ? AND version = ? AND image_preview_webp IS NULL AND image_webp <> ?
    RETURNING id`).bind(preview, id, version, preview).first();
  if (!row) throw {error: "The campaign changed or already has a protected preview.", status: 409};
  return {protected: true};
}
