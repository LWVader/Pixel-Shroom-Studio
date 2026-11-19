const columns = "id, name, sector, tagline, brief, creative_value, image_alt, palette, published, version, updated_at";
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const sectors = new Set(["food", "games", "music", "fashion", "other"]);

function clean(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function urls(row, admin) {
  const {creative_value: value, image_alt: alt, palette, ...item} = row;
  return {...item, value, alt, colors: palette ? palette.split(",") : [],
    imageUrl: `${admin ? "/api/admin/portfolio" : "/api/portfolio"}/${item.id}/image?v=${item.version}`};
}

function validImage(base64) {
  if (typeof base64 !== "string" || base64.length < 28 || base64.length > 1_100_000 ||
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
    `SELECT ${columns} FROM portfolio_campaigns ${admin ? "" : "WHERE published = 1"}
     ORDER BY updated_at DESC, id LIMIT 25 OFFSET ?`
  ).bind(offset).all();
  return {campaigns: results.slice(0, 24).map((row) => urls(row, admin)), more: results.length > 24};
}

export async function portfolioItem(db, id) {
  if (!uuid.test(id ?? "")) return null;
  const row = await db.prepare(`SELECT ${columns} FROM portfolio_campaigns WHERE id = ? AND published = 1`).bind(id).first();
  return row ? urls(row, false) : null;
}

export async function portfolioImage(db, id, admin) {
  if (!uuid.test(id)) return null;
  const row = await db.prepare(
    `SELECT image_webp FROM portfolio_campaigns WHERE id = ? ${admin ? "" : "AND published = 1"}`
  ).bind(id).first();
  return row ? Uint8Array.from(atob(row.image_webp), (char) => char.charCodeAt(0)) : null;
}

export async function savePortfolio(db, input) {
  const {id, version, sector, image, published} = input ?? {};
  const name = clean(input?.name, 100), tagline = clean(input?.tagline, 160);
  const brief = clean(input?.brief, 600), value = clean(input?.value, 800), alt = clean(input?.alt, 160);
  const colors = clean(input?.palette, 60).split(/[\s,]+/).filter(Boolean).map((color) => color.toUpperCase());
  if (typeof id !== "string" || !uuid.test(id) || !Number.isSafeInteger(version) || version < 0 ||
      !sectors.has(sector) || typeof published !== "boolean" || !name || !tagline || !brief || !value || !alt ||
      colors.length > 5 || colors.some((color) => !/^#[0-9A-F]{6}$/.test(color))) {
    throw {error: "Complete the campaign fields and use up to five hex colors.", status: 400};
  }
  if ((version === 0 || image != null) && !validImage(image)) {
    throw {error: "Upload a valid campaign WebP image under 800 KB.", status: 400};
  }
  const now = new Date().toISOString();
  const values = [name, sector, tagline, brief, value, alt, colors.join(","), image ?? null, +published, now];
  const row = version === 0
    ? await db.prepare(`INSERT INTO portfolio_campaigns
        (name,sector,tagline,brief,creative_value,image_alt,palette,image_webp,published,updated_at,id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING RETURNING ${columns}`)
      .bind(...values, id).first()
    : await db.prepare(`UPDATE portfolio_campaigns SET name=?,sector=?,tagline=?,brief=?,creative_value=?,
        image_alt=?,palette=?,image_webp=COALESCE(?,image_webp),published=?,updated_at=?,version=version+1
        WHERE id=? AND version=? RETURNING ${columns}`).bind(...values, id, version).first();
  if (!row) throw {error: "This campaign changed. Refresh before saving again.", status: 409};
  return urls(row, true);
}
