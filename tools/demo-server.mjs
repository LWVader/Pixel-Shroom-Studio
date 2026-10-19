import { prepareCopyImage } from "../mint-worker/copy-identity.mjs";
// Local visual demo only. No credentials, upstream requests or real transactions.
import http from "node:http";
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateKeyPairSync, webcrypto } from "node:crypto";
import { renderMint, renderMarketPreview, sha256 } from "../mint-worker/render.mjs";
const root = fileURLToPath(new URL("../public/", import.meta.url));
const tiers = ["Standard", "Silver", "Gold", "Emerald", "Sapphire", "Prismatic"];
const port = Number(process.env.DEMO_PORT || 8030);
const origin = `http://127.0.0.1:${port}`;
const mintId = "11111111-1111-4111-8111-111111111111";
const leaseId = "22222222-2222-4222-8222-222222222222";
async function loadDemoImage() {
  const samplePath =
    process.env.DEMO_IMAGE ||
    fileURLToPath(new URL("./demo-assets/joyful-banana.webp", import.meta.url));
  try {
    return await fs.readFile(samplePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    console.log("Sample image not found; using the built-in local demo illustration.");
    // A code-generated fixture keeps the demo independent of optional gallery assets.
    return sharp(
      Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
      <defs><linearGradient id="sky" x2="1" y2="1"><stop stop-color="#092f35"/><stop offset="1" stop-color="#102015"/></linearGradient><radialGradient id="glow"><stop stop-color="#8ae6e8"/><stop offset="1" stop-color="#126a76"/></radialGradient></defs>
      <rect width="512" height="512" fill="url(#sky)"/>
      <circle cx="256" cy="218" r="150" fill="url(#glow)" opacity=".65"/>
      <path d="M0 405Q120 300 256 399T512 370V512H0Z" fill="#143d30"/>
      <path d="M226 283Q240 365 214 400Q256 422 298 400Q272 365 286 283Z" fill="#f4e0aa"/>
      <path d="M105 285Q125 100 256 114Q387 100 407 285Q256 325 105 285Z" fill="#d76540" stroke="#f4c07b" stroke-width="6"/>
      <g fill="#fff4c4"><ellipse cx="187" cy="230" rx="24" ry="16"/><ellipse cx="280" cy="168" rx="25" ry="18"/><ellipse cx="342" cy="249" rx="22" ry="15"/><circle cx="77" cy="95" r="4"/><circle cx="435" cy="143" r="5"/><circle cx="95" cy="358" r="3"/></g>
      <text x="24" y="462" font-family="sans-serif" font-size="21" fill="#fff4c4">PIXEL SHROOM · LOCAL DEMO</text>
      <text x="24" y="490" font-family="sans-serif" font-size="14" fill="#b8c9c0">Sample fixture — not a purchasable studio edition</text>
    </svg>`),
    )
      .png()
      .toBuffer();
  }
}
const bytes = await loadDemoImage();
const key = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
]);
const payload = {
  version: 1,
  serialNumber: "LWV-0000000001",
  creator: "LOCAL DEMO — not a studio issuance",
  sha256: sha256(bytes),
};
const listing = {
  max_supply: 500,
  master_serial: payload.serialNumber,
  master_sha256: payload.sha256,
  master_record: {
    payload_version: 1,
    serial_number: payload.serialNumber,
    creator: payload.creator,
    sha256: payload.sha256,
    public_key_jwk: await webcrypto.subtle.exportKey("jwk", key.publicKey),
    signature: Buffer.from(
      await webcrypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        key.privateKey,
        new TextEncoder().encode(JSON.stringify(payload)),
      ),
    ).toString("base64"),
  },
};
const { privateKey } = generateKeyPairSync("ed25519");
const variants = new Map();
console.log("Preparing local uploaded-image copies. Please wait for the Open URL message…");
for (const tier of tiers) {
  let tierBytes = bytes;
  if (process.env.DEMO_TIER_DIR) {
    let found = false;
    for (const ext of ["webp", "png", "jpg", "jpeg"]) {
      try {
        tierBytes = await fs.readFile(
          path.join(process.env.DEMO_TIER_DIR, `${tier.toLowerCase()}.${ext}`),
        );
        found = true;
        break;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    if (!found) throw new Error(`Missing finished ${tier} image in DEMO_TIER_DIR`);
  }
  const metadata = await sharp(tierBytes).metadata();
  const swapped = [5, 6, 7, 8].includes(metadata.orientation);
  const copy = {
    id: `44444444-4444-4444-8444-${String(tiers.indexOf(tier) + 1).padStart(12, "0")}`,
    listing_id: 1,
    tier,
    copy_number: 1,
    source_sha256: sha256(tierBytes),
    mint_id: mintId,
  };
  copy.sha256 = sha256(
    prepareCopyImage(
      tierBytes,
      { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" }[metadata.format],
      copy,
    ),
  );
  const rendered = await renderMint(
    tierBytes,
    {
      listing,
      mint: {
        id: mintId,
        listing_id: 1,
        tier,
        mint_number: 42,
        asset_mode: "inventory",
        copy_id: copy.id,
      },
      copy,
      tier_asset: {
        listing_id: 1,
        tier,
        sha256: sha256(tierBytes),
        mime_type: { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" }[metadata.format],
        width: swapped ? metadata.height : metadata.width,
        height: swapped ? metadata.width : metadata.height,
      },
    },
    privateKey,
    "LOCAL-DEMO-ONLY",
  );
  variants.set(tier, {
    ...rendered,
    preview: await renderMarketPreview(rendered.bytes, {
      sha256: sha256(rendered.bytes),
      mintNumber: 42,
    }),
  });
}
const edition = {
  artworkId: 1,
  enabled: true,
  maxSupply: 500,
  totalMinted: 42,
  reserved: 2,
  prismaticsRemaining: 3,
  silverCap: 100,
  goldCap: 50,
  emeraldCap: 30,
  sapphireCap: 15,
  rulesVersion: 2,
  dropRates: { Standard: 60, Silver: 20, Gold: 10, Emerald: 6, Sapphire: 3, Prismatic: 1 },
  prismaticCap: 5,
  price: 15,
};
const banner = `<div style="position:relative;z-index:1000;background:#f4c07b;color:#040907;padding:10px;text-align:center;font:16px system-ui">LOCAL DEMO · Simulated account and payment · No real orders · Uploaded tier images: set DEMO_TIER_DIR; otherwise all tiers use the same sample · <a style="color:inherit" href="/" target="_top">Demo controls</a></div>`;
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};
function client() {
  return `const session={access_token:'local-demo-user'};
  const send=async(name,body)=>{const q=new URLSearchParams(location.search);const r=await fetch('/demo/api/'+name+'?tier='+(q.get('tier')||'Standard'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await r.json();if(!r.ok)throw Error(result.error);return result;};
  export const invoke=send;
  export const functionUrl=name=>location.origin+'/demo/api/'+name;
  export const supabase={auth:{getSession:async()=>({data:{session}}),onAuthStateChange:()=>{},signOut:async()=>{},signInWithPassword:async()=>({data:{session}}),signUp:async()=>({data:{session}})},rpc:async()=>({data:${JSON.stringify([edition])}})};
  export const mapArtwork=row=>row;`;
}
const demoPage = await fs.readFile(new URL("./demo-page.html", import.meta.url), "utf8");

const purchases = new Map();
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, origin);
  const tier = tiers.includes(url.searchParams.get("tier"))
    ? url.searchParams.get("tier")
    : "Standard";
  const variant = variants.get(tier);
  const send = (body, type = "text/html; charset=utf-8", status = 200) => {
    res.writeHead(status, {
      "Content-Type": type,
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; frame-ancestors 'self'; form-action 'self'",
      "X-Robots-Tag": "noindex, nofollow",
    });
    res.end(body);
  };
  const json = (body, status = 200) => send(JSON.stringify(body), "application/json", status);
  try {
    if (url.pathname === "/") return send(demoPage);
    if (url.pathname === "/config.js")
      return send(
        `export const SUPABASE_URL=${JSON.stringify(origin)}; export const SUPABASE_ANON_KEY='local-demo-only';`,
        "text/javascript",
      );
    if (url.pathname === "/supabase-client.js") return send(client(), "text/javascript");
    if (url.pathname === "/demo/paid") {
      purchases.set(tier, { paidAt: Date.now(), added: false });
      res.writeHead(302, {
        Location: `/checkout-success.html?order=demo&access=demo&tier=${tier}`,
      });
      return res.end();
    }
    if (url.pathname === "/demo/checkout")
      return send(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Simulated checkout</title><link rel="stylesheet" href="/storefront.css"></head><body>${banner}<main style="max-width:650px;margin:60px auto;padding:24px"><h1>Simulated checkout</h1><p>This is a local placeholder, not Stripe Checkout. No card details are collected.</p><p>${tier} edition #42 of 500 · ${url.searchParams.get("market") ? "$50 secondary sale" : "$15 primary mint"}</p><a class="button" href="${url.searchParams.get("market") ? `/market.html?purchase=demo&tier=${tier}` : `/demo/paid?tier=${tier}`}">Simulate successful payment →</a><p><a href="/collection.html?tier=${tier}">Cancel / return to collection</a></p></main></body></html>`,
      );
    if (url.pathname.startsWith("/demo/api/")) {
      if (req.method !== "POST") return json({ error: "POST required" }, 405);
      let input = "";
      for await (const chunk of req) {
        input += chunk;
        if (input.length > 8192) return json({ error: "Request too large" }, 413);
      }
      const body = JSON.parse(input || "{}");
      const name = url.pathname.split("/").pop();
      const item = {
        id: mintId,
        title: "Joyful Banana in Candyland — demo",
        state: "ready",
        mintNumber: 42,
        maxSupply: 500,
        tier,
        width: variant.width,
        height: variant.height,
        imageUrl: `${origin}/storage/v1/object/sign/minted/demo/variant.${{ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[variant.manifest.payload.mimeType]}?tier=${tier}`,
        manifest: variant.manifest,
        canList: true,
      };
      const purchase = purchases.get(tier);
      const paid = !purchase || Boolean(purchase.paidAt);
      const ready = paid && (!purchase || Date.now() - purchase.paidAt > 2500);
      item.state = ready ? "ready" : "queued";
      item.paymentConfirmed = paid;
      item.inCollection = !purchase || purchase.added;
      if (!ready) item.imageUrl = null;
      if (name === "mint-access") {
        if (body.action === "add_to_collection") {
          if (!ready) return json({ error: "Edition not ready" }, 409);
          if (purchase) purchase.added = true;
          return json({ added: true });
        }
        const include =
          body.action === "collection"
            ? item.inCollection
            : body.action === "uncollected"
              ? !item.inCollection
              : true;
        return json({ items: include ? [item] : [], hasMore: false });
      }
      if (name === "order-status")
        return json({
          status: paid ? "paid" : "pending",
          kind: "foil",
          mint: { id: mintId, state: item.state },
        });
      if (name === "mint-checkout") {
        purchases.set(tier, { paidAt: null, added: false });
        return json({ checkoutUrl: `${origin}/demo/checkout?tier=${tier}` });
      }
      if (name === "market-api") {
        if (body.action === "feed")
          return json({
            enabled: true,
            hasMore: false,
            items:
              (body.tier && body.tier !== tier) ||
              (body.search &&
                !"joyful banana in candyland lwv-0000000001".includes(
                  String(body.search).toLowerCase(),
                ))
                ? []
                : [
                    {
                      id: mintId,
                      tier,
                      title: item.title,
                      mint_number: 42,
                      max_supply: 500,
                      serial: "LWV-0000000001",
                      price_cents: 5000,
                      preview_path: `secondary/${mintId}/${leaseId}.webp?tier=${tier}`.split(
                        "?",
                      )[0],
                    },
                  ],
          });
        if (body.action === "seller_status")
          return json({ enabled: true, ready: true, hasAccount: true });
        if (body.action === "mine")
          return json({
            enabled: true,
            items: [
              { id: "local-demo-listing", mint_id: mintId, price_cents: 5000, status: "active" },
            ],
          });
        if (body.action === "checkout")
          return json({ checkoutUrl: `${origin}/demo/checkout?market=1&tier=${tier}` });
        if (body.action === "purchase") return json({ purchase: { state: "succeeded" } });
        if (body.action === "list")
          return json({ listingId: "local-demo-listing", status: "preparing" });
        if (body.action === "cancel") return json({ cancelled: true });
        return json(
          { error: "Local demo: Stripe onboarding and dashboard are not connected." },
          400,
        );
      }
      return json({ error: "Unavailable in local demo" }, 404);
    }
    if (url.pathname.startsWith("/storage/v1/object/sign/minted/"))
      return send(variant.bytes, variant.manifest.payload.mimeType);
    if (url.pathname.startsWith("/storage/v1/object/public/previews/"))
      return send(variant.preview, "image/webp");
    if (url.pathname.startsWith("/rest/")) return json([]);
    const file = path.resolve(root, "." + decodeURIComponent(url.pathname));
    if (
      !file.startsWith(root) ||
      ![".html", ".js", ".css", ".webp", ".png", ".jpg", ".svg", ".woff2", ".ico"].includes(
        path.extname(file),
      )
    )
      return send("Not found", "text/plain", 404);
    let content = await fs.readFile(file);
    // Adapt validators only in this loopback demo response. Production files stay untouched.
    if (url.pathname === "/mint-core.js")
      content = content.toString().replace('url.protocol === "https:"', 'url.protocol === "http:"');
    if (url.pathname === "/catalog-core.js")
      content =
        content
          .toString()
          .replace(
            "export function checkoutUrl(value, provider)",
            "function productionCheckoutUrl(value, provider)",
          ) +
        `\nexport function checkoutUrl(value){ const u=new URL(value);if(u.origin!==location.origin||u.pathname!='/demo/checkout')throw Error('Local demo checkout only');return u.href;}`;
    if (url.pathname === "/market-core.js")
      content = content
        .toString()
        .replace(
          'return base.replace(/\\/$/, "") + "/storage/v1/object/public/previews/" + path;',
          'return base.replace(/\\/$/, "") + "/storage/v1/object/public/previews/" + path + "?tier=" + (new URLSearchParams(location.search).get("tier") || "Standard");',
        );
    if (path.extname(file) === ".html") {
      content = content.toString().replace(/<body[^>]*>/i, (match) => match + banner);
      if (url.pathname === "/checkout-success.html")
        content = content.replace(
          "</head>",
          `<style>.checkout-result{margin:16px auto;padding:18px}.checkout-result h1{font-size:28px}.foil-scene{max-width:min(340px,56vh)}.foil-reveal-controls{margin:8px 0}.foil-purchase-reveal{padding:12px}</style></head>`,
        );
    }
    send(content, mime[path.extname(file)]);
  } catch (error) {
    send(
      error.code === "ENOENT" ? "Not found" : "Local demo request failed",
      "text/plain",
      error.code === "ENOENT" ? 404 : 500,
    );
  }
});
server.on("error", (error) => {
  console.error(
    error.code === "EADDRINUSE"
      ? `Port ${port} is in use. Close the previous demo or set DEMO_PORT.`
      : error.message,
  );
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    `\nPixel Shroom Studio LOCAL DEMO\nOpen ${origin}\nNo API keys or payments. Ctrl+C stops the demo.\n`,
  ),
);
