import { readEbayListings, renderEbayPage } from "./ebay-feed.mjs";
import {
  GENRES,
  genreUrl,
  readPublishedArtworks,
  renderCompiled,
  renderLatest,
  latestArtworks,
  renderGenre,
  escapeHtml,
} from "./public/catalog-core.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./public/config.js";
const CANONICAL = "https://www.pixelshroomstudio.com";
const aliases = new Set([
  "pixelshroomstudio.com",
  "pixel-shroom-studio.phantasmocazdor.workers.dev",
]);
const pages = new Set([
  "faq",
  "all-artwork",
  "canvases",
  "apparel",
  "contact",
  "how-it-works",
  "usage-rights",
  "verify",
  "privacy",
  "terms",
  "cookies",
  "admin",
  "checkout-success",
  "checkout-cancel",
]);
const policy =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://esm.sh; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https://esm.sh https://*.supabase.co wss://*.supabase.co http://127.0.0.1:4179 http://localhost:4179; worker-src 'self' blob:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
let cachedRows = null,
  cachedAt = 0;
function redirect(url) {
  return new Response(null, {
    status: 301,
    headers: { Location: url.href, "Cache-Control": "public,max-age=300" },
  });
}
function headersFor(response, path) {
  const result = new Response(response.body, response);
  result.headers.set("Content-Security-Policy", policy);
  result.headers.set(
    "Referrer-Policy",
    path.startsWith("/checkout-") ? "no-referrer" : "strict-origin-when-cross-origin",
  );
  result.headers.set("X-Content-Type-Options", "nosniff");
  result.headers.set("X-Frame-Options", "DENY");
  result.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (response.headers.get("content-type")?.includes("text/html"))
    result.headers.set(
      "Cache-Control",
      response.status >= 400 || path.startsWith("/checkout-") || path === "/admin.html"
        ? "no-store"
        : "public,max-age=0,must-revalidate",
    );
  if (path.startsWith("/checkout-") || path === "/admin.html")
    result.headers.set("X-Robots-Tag", "noindex,nofollow");
  return result;
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url),
      path = url.pathname;
    if (path === "/physical-order.html" || path === "/physical-order") {
      return redirect(new URL("/canvases.html", url.origin));
    }
    if (
      aliases.has(url.hostname) ||
      (url.hostname === "www.pixelshroomstudio.com" && url.protocol !== "https:")
    ) {
      url.protocol = "https:";
      url.host = "www.pixelshroomstudio.com";
      return redirect(url);
    }
    if (request.method !== "GET" && request.method !== "HEAD")
      return headersFor(
        new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } }),
        path,
      );
    if (path === "/api/ebay-listings") {
      let payload,
        status = 200;
      try {
        payload = await readEbayListings(env);
      } catch {
        status = 503;
        payload = { error: "Live eBay listings are unavailable. Please visit our eBay store." };
      }
      const result = Response.json(payload, {
        status,
        headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
      });
      return headersFor(new Response(request.method === "HEAD" ? null : result.body, result), path);
    }
    if (path === "/index.html" || path === "/index") {
      url.pathname = "/";
      return redirect(url);
    }
    if (["/artwork", "/artwork/", "/artwork.html"].includes(path)) {
      url.pathname = "/all-artwork.html";
      url.hash = "";
      return redirect(url);
    }
    const old = path.match(/^\/(?:genre|genres)\/([a-z-]+)(?:\.html)?\/?$/);
    if (old) {
      if (Object.hasOwn(GENRES, old[1])) {
        url.pathname = "/genre.html";
        url.searchParams.set("genre", old[1]);
        return redirect(url);
      }
      return this.notFound(request, env);
    }
    const clean = path.match(/^\/([a-z-]+)\/?$/);
    if (clean && pages.has(clean[1])) {
      url.pathname = "/" + clean[1] + ".html";
      return redirect(url);
    }
    let slug = null,
      assetUrl = new URL(url);
    // html_handling=none requires the exact asset filename, including the homepage.
    if (path === "/") assetUrl.pathname = "/index.html";
    if (path === "/genre" || path === "/genre/") {
      url.pathname = "/genre.html";
      return redirect(url);
    }
    if (path === "/genre.html") {
      const values = url.searchParams.getAll("genre"),
        value = values[0] || "";
      slug = value.toLowerCase();
      if (values.length === 0) {
        url.pathname = "/all-artwork.html";
        url.hash = "";
        return redirect(url);
      }
      if (values.length !== 1 || !Object.hasOwn(GENRES, slug)) return this.notFound(request, env);
      if (value !== slug) {
        url.searchParams.set("genre", slug);
        return redirect(url);
      }
      assetUrl.pathname = "/genres/" + slug + ".html";
      assetUrl.search = "";
    }
    const assetHeaders = new Headers(request.headers);
    if (
      ["/", "/all-artwork.html", "/genre.html", "/canvases.html", "/apparel.html"].includes(path)
    ) {
      assetHeaders.delete("if-none-match");
      assetHeaders.delete("if-modified-since");
    }
    const response = await env.ASSETS.fetch(
      new Request(assetUrl, { method: request.method, headers: assetHeaders }),
    );
    if (response.status === 404) return this.notFound(request, env);
    if (["/canvases.html", "/apparel.html"].includes(path) && response.ok) {
      const category = path === "/canvases.html" ? "canvas" : "apparel";
      let catalog = null;
      try {
        catalog = await readEbayListings(env);
      } catch {
        /* Store link remains available. */
      }
      const html = renderEbayPage(await response.text(), category, catalog);
      const headers = new Headers(response.headers);
      for (const name of ["content-length", "etag", "last-modified"]) headers.delete(name);
      headers.set("Content-Type", "text/html; charset=utf-8");
      return headersFor(
        new Response(request.method === "HEAD" ? null : html, { status: 200, headers }),
        path,
      );
    }

    if ((path === "/" || path === "/all-artwork.html" || path === "/genre.html") && response.ok) {
      let content = await response.text();
      try {
        const fetcher = env.CATALOG_FETCH || fetch;
        if (!cachedRows || Date.now() - cachedAt > 60000) {
          cachedRows = await readPublishedArtworks(SUPABASE_URL, SUPABASE_ANON_KEY, {
            fetcher,
            signal: AbortSignal.timeout(6000),
          });
          cachedAt = Date.now();
        }
        const rows = slug
          ? cachedRows.filter((x) => x.category === GENRES[slug].name)
          : path === "/"
            ? latestArtworks(cachedRows)
            : cachedRows;
        const markup = slug
          ? renderGenre(rows, slug)
          : path === "/"
            ? renderLatest(rows)
            : renderCompiled(rows);
        content = content.replace(
          /<!--CATALOG_START-->[\s\S]*?<!--CATALOG_END-->/,
          "<!--CATALOG_START-->" + markup + "<!--CATALOG_END-->",
        );
        const payload = JSON.stringify({ rows, genre: slug, loadedAt: cachedAt }).replace(
          /</g,
          "\\u003c",
        );
        content = content.replace(
          "<!--BOOTSTRAP-->",
          `<script id="catalog-bootstrap" type="application/json">${payload}</script>`,
        );
        content = content
          .replace(
            "Checking current published listings…",
            path === "/"
              ? `${rows.length} recent artworks. Newest first.`
              : `${cachedRows.length} published listings. Showing up to four per genre.`,
          )
          .replace(
            "Checking current listings…",
            `${rows.length} published ${escapeHtml(GENRES[slug]?.name || "")} listings.`,
          );
        content = content.replace('aria-busy="true"', 'aria-busy="false"');
        // Artwork metadata reflects visible public previews, never unconfirmed sales or ratings.
        const visibleSerials = [...markup.matchAll(/data-serial="([^"]+)"/g)].map((x) => x[1]);
        const artworks = rows
          .filter((x) => visibleSerials.includes(escapeHtml(x.serial_number)))
          .map((x) => ({
            "@type": "VisualArtwork",
            name: x.title,
            identifier: x.serial_number,
            genre: x.category,
            artform: "AI-generated digital artwork",
            image: x.preview_url,
            creator: { "@type": "Person", name: x.artist || "LWVader" },
          }));
        if (artworks.length)
          content = content.replace(
            "</head>",
            `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "ItemList", itemListElement: artworks.map((art, i) => ({ "@type": "ListItem", position: i + 1, item: art })) }).replace(/</g, "\\u003c")}</script></head>`,
          );
      } catch {
        content = content
          .replace(
            "Checking current published listings…",
            "The live collection is temporarily unavailable. Open a genre or try again shortly.",
          )
          .replace(
            "Checking current listings…",
            "The live collection is temporarily unavailable. Please try again shortly.",
          );
      }
      const h = new Headers(response.headers);
      h.delete("content-length");
      h.delete("etag");
      h.delete("last-modified");
      h.set("Content-Type", "text/html; charset=utf-8");
      const canonical =
        CANONICAL +
        (slug ? genreUrl(slug) : path === "/all-artwork.html" ? "/all-artwork.html" : "/");
      h.set("Link", `<${canonical}>; rel="canonical"`);
      return headersFor(
        new Response(request.method === "HEAD" ? null : content, { status: 200, headers: h }),
        path,
      );
    }
    return headersFor(response, path);
  },
  async notFound(request, env) {
    const u = new URL("/404.html", request.url);
    const asset = await env.ASSETS.fetch(new Request(u, { method: "GET" }));
    const h = new Headers(asset.headers);
    h.set("X-Robots-Tag", "noindex,follow");
    h.set("Cache-Control", "no-store");
    return headersFor(
      new Response(request.method === "HEAD" ? null : asset.body, { status: 404, headers: h }),
      u.pathname,
    );
  },
};
