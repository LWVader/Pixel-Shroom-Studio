// SECTION: Node.js runtime dependencies
import http from "node:http";
import { readFileSync, existsSync, createReadStream, statSync } from "node:fs";
import { resolve, extname, basename, relative, isAbsolute } from "node:path";
import { randomBytes, pbkdf2Sync, createHmac, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
// SECTION: Application paths, environment values, and server configuration
const root = resolve(import.meta.dirname);
const publicDir = resolve(root, "public");
const privateDir = resolve(root, "private-originals");
function isInside(parent, target) {
  const pathFromParent = relative(parent, target);
  return pathFromParent !== "" && !pathFromParent.startsWith("..") && !isAbsolute(pathFromParent);
}
if (existsSync(resolve(root, ".env"))) {
  for (const line of readFileSync(resolve(root, ".env"), "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}
const config = { port: Number(process.env.PORT || 3e3), adminEmail: (process.env.ADMIN_EMAIL || "phantasmocazdor@gmail.com").toLowerCase(), adminPassword: process.env.ADMIN_PASSWORD || "password", sessionSecret: process.env.SESSION_SECRET || "development-session-secret-change-me", downloadSecret: process.env.DOWNLOAD_SECRET || "development-download-secret-change-me", privateImageHosts: new Set((process.env.PRIVATE_IMAGE_HOSTS || "i.postimg.cc,postimg.cc").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean)) };
// SECTION: SQLite schema, forward-compatible migrations, indexes, and starter records
const db = new DatabaseSync(resolve(root, "artvault.sqlite"));
db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS admins(email TEXT PRIMARY KEY,password_hash TEXT NOT NULL,password_salt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires_at INTEGER NOT NULL,FOREIGN KEY(email) REFERENCES admins(email));
CREATE TABLE IF NOT EXISTS artworks(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,artist TEXT NOT NULL,category TEXT NOT NULL,price REAL NOT NULL,preview_url TEXT,original_key TEXT NOT NULL,display_width INTEGER NOT NULL DEFAULT 600,display_height INTEGER NOT NULL DEFAULT 250,status TEXT NOT NULL DEFAULT 'published',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY AUTOINCREMENT,artwork_id INTEGER NOT NULL,provider TEXT NOT NULL,provider_event_id TEXT UNIQUE,status TEXT NOT NULL DEFAULT 'pending',amount REAL NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(artwork_id) REFERENCES artworks(id));
CREATE TABLE IF NOT EXISTS licenses(id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INTEGER NOT NULL UNIQUE,expires_at INTEGER NOT NULL,download_limit INTEGER NOT NULL DEFAULT 3,download_count INTEGER NOT NULL DEFAULT 0,FOREIGN KEY(order_id) REFERENCES orders(id));`);
db.exec(`CREATE TABLE IF NOT EXISTS articles(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,excerpt TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'published',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
function ensureColumn(table, column, declaration) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
}
ensureColumn("orders", "buyer_email", "TEXT");
ensureColumn("orders", "fulfillment_status", "TEXT NOT NULL DEFAULT 'automatic'");
ensureColumn("artworks", "serial_number", "TEXT");
db.exec("CREATE INDEX IF NOT EXISTS idx_artworks_status_category ON artworks(status,category); CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status,created_at);");
function passwordRecord(password, salt = randomBytes(16).toString("hex")) {
  return { salt, hash: pbkdf2Sync(password, salt, 1e5, 32, "sha256").toString("hex") };
}
if (!db.prepare("SELECT 1 FROM admins WHERE email=?").get(config.adminEmail)) {
  const credential = passwordRecord(config.adminPassword);
  db.prepare("INSERT INTO admins(email,password_hash,password_salt) VALUES(?,?,?)").run(config.adminEmail, credential.hash, credential.salt);
}
if (db.prepare("SELECT count(*) AS total FROM artworks").get().total === 0) {
  const insert = db.prepare("INSERT INTO artworks(title,artist,category,price,preview_url,original_key,display_width,display_height,status,serial_number) VALUES(?,?,?,?,?,?,?,?,?,?)");
  [["Neon Reverie", "Loren Weirich", "Sci-Fi", 125, null, "sample-neon.png", 600, 250, "published", "LWV-0000000001"], ["Forest Oracle", "Loren Weirich", "Fantasy", 95, null, "sample-oracle.png", 600, 300, "published", "LWV-0000000002"], ["Chromatic Token 01", "Loren Weirich", "NFT", 250, null, "sample-nft.png", 600, 250, "published", "LWV-0000000003"]].forEach((row) => insert.run(...row));
}
const fallbackImages = { Portrait: "/assets/art-portrait.png", Fantasy: "/assets/art-fantasy.png", Landscape: "/assets/art-landscape.png", "Sci-Fi": "/assets/art-sci-fi.png", Abstract: "/assets/art-abstract.png", Dreamscape: "/assets/art-dreamscape.png", NFT: "/assets/art-abstract.png" };
for (const [category, preview] of Object.entries(fallbackImages)) db.prepare("UPDATE artworks SET preview_url=? WHERE category=? AND preview_url IS NULL").run(preview, category);
db.prepare("UPDATE artworks SET serial_number='LWV-UNASSIGNED-' || id WHERE serial_number IS NULL OR serial_number=''").run();
// SECTION: HTTP JSON, request-body, cookie, and administrator-session helpers
const json = (res, status, data) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
};
async function body(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1e6) throw new Error("Request too large.");
  }
  return raw ? JSON.parse(raw) : {};
}
const cookies = (req) => Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map((value) => value.trim().split("=").map(decodeURIComponent)));
const digest = (value) => createHmac("sha256", config.sessionSecret).update(value).digest("hex");
function admin(req) {
  const token = cookies(req).artvault_session;
  if (!token) return null;
  return db.prepare("SELECT email FROM sessions WHERE token_hash=? AND expires_at>?").get(digest(token), Date.now()) || null;
}
function setSession(res, email) {
  const token = randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO sessions(token_hash,email,expires_at) VALUES(?,?,?)").run(digest(token), email, Date.now() + 8 * 60 * 60 * 1e3);
  res.setHeader("Set-Cookie", `artvault_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
}
// SECTION: Public Postimages hotlink parsing and private original-source validation
function normalizePreviewHotlink(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const imageSourceMatch = raw.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/i);
  const source = (imageSourceMatch?.[1] || raw).replaceAll("&amp;", "&").trim();

  if (source.startsWith("/assets/")) return source;

  let url;
  try {
    url = new URL(source);
  } catch {
    throw new Error("Paste a Postimages Hotlink for websites code or its HTTPS image URL.");
  }
  if (url.protocol !== "https:") throw new Error("Website preview hotlinks must use HTTPS.");
  if (!config.privateImageHosts.has(url.hostname.toLowerCase())) throw new Error("Website preview hotlinks must use an approved Postimages host.");
  return url.toString();
}

function sourcesMatch(first, second) {
  if (!first || !second) return false;
  try {
    return new URL(first).toString() === new URL(second).toString();
  } catch {
    return first === second;
  }
}

function validateOriginalSource(source) {
  if (!source) return;
  try {
    const url = new URL(source);
    if (url.protocol !== "https:" || !config.privateImageHosts.has(url.hostname.toLowerCase())) throw new Error("Private image links must use HTTPS and an approved host.");
  } catch (error) {
    if (source.includes("://")) throw error;
    if (source.includes("..") || isAbsolute(source)) throw new Error("Local original keys must be relative filenames.");
  }
}
function artworkInput(data, isNew) {
  const title = String(data.title || "").trim(), artist = String(data.artist || "").trim(), category = String(data.category || "").trim(), serialNumber = String(data.serialNumber || "").trim().toUpperCase(), price = Number(data.price), previewUrl = normalizePreviewHotlink(data.previewUrl), originalKey = String(data.originalKey || "").trim(), displayWidth = Number(data.displayWidth), displayHeight = Number(data.displayHeight), status = ["draft", "published", "archived"].includes(data.status) ? data.status : "published";
  if (!title || !artist || !category || !serialNumber) throw new Error("Title, artist, serial number, and genre are required.");
  if (!Number.isFinite(price) || price <= 0) throw new Error("Enter a valid price greater than zero.");
  if (!Number.isInteger(displayWidth) || displayWidth < 160 || displayWidth > 1600 || !Number.isInteger(displayHeight) || displayHeight < 120 || displayHeight > 1600) throw new Error("Display width and height must be whole numbers within the allowed range.");
  if (!/^[A-Z0-9-]{4,40}$/.test(serialNumber)) throw new Error("Serial numbers may contain only letters, numbers, and hyphens.");
  if (isNew && status === "published" && !previewUrl) throw new Error("Add the Postimages watermarked preview hotlink before publishing.");
  if (isNew && status === "published" && category !== "NFT" && !originalKey) throw new Error("Add the private original PNG direct link before publishing, or save the listing as a draft.");
  validateOriginalSource(originalKey);
  if (sourcesMatch(previewUrl, originalKey)) throw new Error("The public hotlink must be a separate watermarked preview, never the private original PNG link.");
  return { title, artist, category, serialNumber, price, previewUrl: previewUrl || fallbackImages[category] || null, originalKey, displayWidth, displayHeight, status };
}
// SECTION: Public artwork mapping deliberately excludes private original links
function publicArtwork(row) {
  return { id: row.id, title: row.title, artist: row.artist, category: row.category, serialNumber: row.serial_number, price: row.price, previewUrl: row.preview_url, displayWidth: row.display_width, displayHeight: row.display_height, status: row.status };
}
function adminArtwork(row) {
  return { ...publicArtwork(row), hasOriginal: Boolean(row.original_key) };
}
// SECTION: Expiring download-token signing and verification
function signDownload(orderId, expiresAt) {
  const payload = `${orderId}.${expiresAt}`;
  return `${payload}.${createHmac("sha256", config.downloadSecret).update(payload).digest("base64url")}`;
}
function verifyDownload(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const payload = `${parts[0]}.${parts[1]}`, expected = createHmac("sha256", config.downloadSecret).update(payload).digest("base64url");
  if (parts[2].length !== expected.length || !timingSafeEqual(Buffer.from(parts[2]), Buffer.from(expected)) || Number(parts[1]) < Date.now()) return null;
  return { orderId: Number(parts[0]), expiresAt: Number(parts[1]) };
}
// SECTION: Payment webhook placeholders and approved private-original retrieval
async function verifyStripeWebhook() {
  throw new Error("PAYMENT_PROVIDER_CONFIGURATION_REQUIRED: add official Stripe signature verification.");
}
async function verifyPayPalWebhook() {
  throw new Error("PAYMENT_PROVIDER_CONFIGURATION_REQUIRED: add official PayPal webhook verification.");
}
async function fetchApprovedOriginal(source, remainingRedirects = 3) {
  const url = new URL(source);
  if (url.protocol !== "https:" || !config.privateImageHosts.has(url.hostname.toLowerCase())) throw new Error("Original host is not approved.");
  const response = await fetch(url, { redirect: "manual" });
  if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
    if (remainingRedirects === 0) throw new Error("Too many image redirects.");
    return fetchApprovedOriginal(new URL(response.headers.get("location"), url).toString(), remainingRedirects - 1);
  }
  if (!response.ok || !response.body) throw new Error("Private original could not be retrieved.");
  return response;
}
// SECTION: Storefront, admin, order, webhook, and delivery API routes
async function api(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/artworks") {
    const category = url.searchParams.get("category");
    const rows = category ? db.prepare("SELECT * FROM artworks WHERE status='published' AND category=? ORDER BY created_at DESC").all(category) : db.prepare("SELECT * FROM artworks WHERE status='published' ORDER BY created_at DESC").all();
    return json(res, 200, rows.map(publicArtwork));
  }
  if (req.method === "GET" && url.pathname === "/api/site") {
    return json(res, 200, { articles: db.prepare("SELECT id,title,excerpt,body,created_at AS createdAt FROM articles WHERE status='published' ORDER BY created_at DESC").all() });
  }
  if (req.method === "POST" && url.pathname === "/api/orders") {
    const data = await body(req), art = db.prepare("SELECT * FROM artworks WHERE id=? AND status='published'").get(Number(data.artworkId));
    if (!art) return json(res, 404, { error: "Artwork not found." });
    if (!["stripe", "paypal"].includes(data.provider)) return json(res, 400, { error: "Invalid provider." });
    const buyerEmail = String(data.buyerEmail || "").trim().toLowerCase();
    if (art.category === "NFT" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) return json(res, 400, { error: "A valid delivery email is required for NFT orders." });
    const fulfillment = art.category === "NFT" ? "email_pending" : "automatic";
    const result = db.prepare("INSERT INTO orders(artwork_id,provider,status,amount,buyer_email,fulfillment_status) VALUES(?,?,?,?,?,?)").run(art.id, data.provider, "pending", art.price, buyerEmail || null, fulfillment);
    return json(res, 201, { orderId: Number(result.lastInsertRowid), message: art.category === "NFT" ? `NFT order created. After verified payment, the ZIP will be manually sent to ${buyerEmail}.` : `${data.provider === "stripe" ? "Stripe" : "PayPal"} checkout placeholder created. Configure the provider API before accepting payments.` });
  }
  if (req.method === "POST" && url.pathname.startsWith("/api/webhooks/")) {
    try {
      const event = url.pathname.endsWith("stripe") ? await verifyStripeWebhook(req) : await verifyPayPalWebhook(req);
      const order = db.prepare("UPDATE orders SET status='paid',provider_event_id=? WHERE id=? AND status='pending' RETURNING *").get(event.id, event.orderId);
      if (order) {
        const art = db.prepare("SELECT category FROM artworks WHERE id=?").get(order.artwork_id);
        if (art?.category === "NFT") return json(res, 200, { received: true, fulfillment: "email_pending" });
        const expiresAt = Date.now() + 24 * 60 * 60 * 1e3;
        db.prepare("INSERT OR IGNORE INTO licenses(order_id,expires_at,download_limit) VALUES(?,?,3)").run(order.id, expiresAt);
        return json(res, 200, { received: true, downloadPath: `/api/download?token=${signDownload(order.id, expiresAt)}` });
      }
      return json(res, 200, { received: true });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }
  if (req.method === "GET" && url.pathname === "/api/download") {
    const verified = verifyDownload(url.searchParams.get("token"));
    if (!verified) return json(res, 403, { error: "Invalid or expired download link." });
    const record = db.prepare("SELECT l.*,a.original_key,a.category FROM licenses l JOIN orders o ON o.id=l.order_id JOIN artworks a ON a.id=o.artwork_id WHERE l.order_id=? AND o.status='paid'").get(verified.orderId);
    if (!record || record.category === "NFT" || record.expires_at < Date.now() || record.download_count >= record.download_limit) return json(res, 403, { error: "Download link expired or limit reached." });
    db.prepare("UPDATE licenses SET download_count=download_count+1 WHERE id=?").run(record.id);
    if (record.original_key.startsWith("https://")) {
      try {
        const remote = await fetchApprovedOriginal(record.original_key);
        const originalName = basename(new URL(record.original_key).pathname) || `pixel-shroom-original-${record.order_id}.png`;
        res.writeHead(200, { "Content-Type": remote.headers.get("content-type") || "image/png", "Content-Disposition": `attachment; filename="${originalName.replace(/[^A-Za-z0-9._-]/g, "-")}"`, "Cache-Control": "private, no-store" });
        return Readable.fromWeb(remote.body).pipe(res);
      } catch (error) {
        return json(res, 502, { error: error.message });
      }
    }
    const file = resolve(privateDir, record.original_key);
    if (!isInside(privateDir, file) || !existsSync(file)) return json(res, 404, { error: "Original unavailable." });
    res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${basename(file)}"`, "Content-Length": statSync(file).size, "Cache-Control": "private, no-store" });
    return createReadStream(file).pipe(res);
  }
  if (req.method === "POST" && url.pathname === "/api/admin/login") {
    const data = await body(req), email = String(data.email || "").toLowerCase(), row = db.prepare("SELECT * FROM admins WHERE email=?").get(email);
    if (!row) return json(res, 401, { error: "Invalid email or password." });
    const attempt = passwordRecord(String(data.password || ""), row.password_salt).hash;
    if (attempt.length !== row.password_hash.length || !timingSafeEqual(Buffer.from(attempt), Buffer.from(row.password_hash))) return json(res, 401, { error: "Invalid email or password." });
    setSession(res, email);
    return json(res, 200, { ok: true });
  }
  if (req.method === "GET" && url.pathname === "/api/admin/session") return admin(req) ? json(res, 200, { authenticated: true }) : json(res, 401, { error: "Sign in required." });
  if (req.method === "POST" && url.pathname === "/api/admin/logout") {
    const token = cookies(req).artvault_session;
    if (token) db.prepare("DELETE FROM sessions WHERE token_hash=?").run(digest(token));
    res.setHeader("Set-Cookie", "artvault_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
    return json(res, 200, { ok: true });
  }
  if (url.pathname.startsWith("/api/admin/") && !admin(req)) return json(res, 401, { error: "Administrator access required." });
  if (req.method === "GET" && url.pathname === "/api/admin/artworks") return json(res, 200, db.prepare("SELECT * FROM artworks ORDER BY created_at DESC").all().map(adminArtwork));
  if (req.method === "GET" && url.pathname === "/api/admin/dashboard") return json(res, 200, { articles: db.prepare("SELECT id,title,excerpt,body,status,created_at AS createdAt FROM articles ORDER BY created_at DESC").all(), orderStats: db.prepare("SELECT status,count(*) AS total FROM orders GROUP BY status").all(), orders: db.prepare("SELECT o.id,o.status,o.amount,o.buyer_email AS buyerEmail,o.fulfillment_status AS fulfillmentStatus,o.created_at AS createdAt,a.title,a.category,a.serial_number AS serialNumber FROM orders o JOIN artworks a ON a.id=o.artwork_id ORDER BY o.created_at DESC LIMIT 100").all() });
  const fulfillmentMatch = url.pathname.match(/^\/api\/admin\/orders\/(\d+)\/fulfilled$/);
  if (fulfillmentMatch && req.method === "PATCH") {
    db.prepare("UPDATE orders SET fulfillment_status='email_sent' WHERE id=? AND status='paid'").run(Number(fulfillmentMatch[1]));
    return json(res, 200, { ok: true });
  }
  if (req.method === "POST" && url.pathname === "/api/admin/articles") {
    const data = await body(req), title = String(data.title || "").trim(), excerpt = String(data.excerpt || "").trim(), articleBody = String(data.body || "").trim();
    if (!title || !excerpt || !articleBody) return json(res, 400, { error: "Complete every article field." });
    const result = db.prepare("INSERT INTO articles(title,excerpt,body,status) VALUES(?,?,?,?)").run(title, excerpt, articleBody, "published");
    return json(res, 201, { id: Number(result.lastInsertRowid) });
  }
  const articleMatch = url.pathname.match(/^\/api\/admin\/articles\/(\d+)$/);
  if (articleMatch && req.method === "PATCH") {
    const data = await body(req), status = data.status === "published" ? "published" : "draft";
    db.prepare("UPDATE articles SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status, Number(articleMatch[1]));
    return json(res, 200, { ok: true });
  }
  if (req.method === "POST" && url.pathname === "/api/admin/artworks") {
    try {
      const value = artworkInput(await body(req), true), result = db.prepare("INSERT INTO artworks(title,artist,category,price,preview_url,original_key,display_width,display_height,status,serial_number) VALUES(?,?,?,?,?,?,?,?,?,?)").run(value.title, value.artist, value.category, value.price, value.previewUrl, value.originalKey, value.displayWidth, value.displayHeight, value.status, value.serialNumber);
      return json(res, 201, { id: Number(result.lastInsertRowid) });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }
  const match = url.pathname.match(/^\/api\/admin\/artworks\/(\d+)$/);
  if (match && req.method === "PUT") {
    try {
      const data = await body(req), value = artworkInput(data, false), existing = db.prepare("SELECT original_key FROM artworks WHERE id=?").get(Number(match[1]));
      if (!existing) return json(res, 404, { error: "Listing not found." });
      const effectiveOriginal = value.originalKey || existing.original_key;
      if (sourcesMatch(value.previewUrl, effectiveOriginal)) throw new Error("The public hotlink must be a separate watermarked preview, never the private original PNG link.");
      db.prepare("UPDATE artworks SET title=?,artist=?,category=?,price=?,preview_url=?,original_key=?,display_width=?,display_height=?,status=?,serial_number=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(value.title, value.artist, value.category, value.price, value.previewUrl, effectiveOriginal, value.displayWidth, value.displayHeight, value.status, value.serialNumber, Number(match[1]));
      return json(res, 200, { ok: true });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }
  if (match && req.method === "PATCH") {
    const data = await body(req), status = ["published", "archived", "draft"].includes(data.status) ? data.status : null;
    if (!status) return json(res, 400, { error: "Invalid status." });
    db.prepare("UPDATE artworks SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status, Number(match[1]));
    return json(res, 200, { ok: true });
  }
  if (req.method === "POST" && url.pathname === "/api/admin/password") {
    const data = await body(req), row = db.prepare("SELECT * FROM admins WHERE email=?").get(config.adminEmail), attempt = passwordRecord(String(data.currentPassword || ""), row.password_salt).hash;
    if (attempt.length !== row.password_hash.length || !timingSafeEqual(Buffer.from(attempt), Buffer.from(row.password_hash))) return json(res, 400, { error: "Current password is incorrect." });
    if (String(data.newPassword || "").length < 12) return json(res, 400, { error: "New password must be at least 12 characters." });
    const next = passwordRecord(String(data.newPassword));
    db.prepare("UPDATE admins SET password_hash=?,password_salt=? WHERE email=?").run(next.hash, next.salt, config.adminEmail);
    db.prepare("DELETE FROM sessions WHERE email=?").run(config.adminEmail);
    return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: "Not found." });
}
// SECTION: Public-file MIME types and traversal-safe static delivery
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
function staticFile(req, res, url) {
  let requestPath = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
  if (/^genre\/[^/]+\/?$/.test(requestPath)) requestPath = "genre.html";
  const file = resolve(publicDir, requestPath);
  if (!isInside(publicDir, file) || !existsSync(file)) return false;
  res.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'", "Referrer-Policy": "no-referrer" });
  if (req.method === "HEAD") return res.end();
  createReadStream(file).pipe(res);
  return true;
}
// SECTION: Main HTTP server lifecycle and centralized error boundary
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    if (!["GET", "HEAD"].includes(req.method)) return json(res, 405, { error: "Method not allowed." });
    if (!staticFile(req, res, url)) json(res, 404, { error: "Not found." });
  } catch (error) {
    console.error(error);
    json(res, 500, { error: "Server error." });
  }
});
server.listen(config.port, () => console.log(`Pixel Shroom Studio running at http://localhost:${config.port}`));
