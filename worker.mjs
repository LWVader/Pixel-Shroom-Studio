import { renderArtworkDetail } from "./public/artwork-page-core.js";
import { safeArtworkId } from "./public/forge-print-core.js";
import { readPrintProducts } from "./gelato-catalog.mjs";
import {
  renderFeatured,
  renderProductExamples,
  renderProjectExample,
} from "./public/studio-home-core.js";
import {
  GENRES,
  genreUrl,
  readPublishedArtworks,
  renderCompiled,
  renderLatest,
  latestArtworks,
  renderGenre,
  escapeHtml,
  cardMarkup,
} from "./public/catalog-core.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./public/config.js";
const CANONICAL = "https://www.pixelshroomstudio.com";
const aliases = new Set([
  "pixelshroomstudio.com",
  "pixel-shroom-studio.phantasmocazdor.workers.dev",
]);
const pages = new Set([
  "about",
  "art",
  "forge",
  "drop-odds",
  "canvas-specs",
  "cart",
  "collection",
  "market",
  "verify-mint",
  "faq",
  "all-artwork",
  "canvases",
  "apparel",
  "print-orders",
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
      response.status >= 400 ||
        path.startsWith("/checkout-") ||
        ["/admin.html", "/collection.html", "/print-orders.html", "/cart.html"].includes(path)
        ? "no-store"
        : "public,max-age=0,must-revalidate",
    );
  if (
    path.startsWith("/checkout-") ||
    ["/admin.html", "/collection.html", "/print-orders.html", "/cart.html"].includes(path)
  )
    result.headers.set("X-Robots-Tag", "noindex,nofollow");
  return result;
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url),
      path = url.pathname;
    if (["/vault", "/vault/", "/vault.html"].includes(path))
      return redirect(new URL("/collection.html", url.origin));
    if (
      path === "/art.html" &&
      (url.searchParams.getAll("id").length !== 1 || !safeArtworkId(url.searchParams.get("id")))
    )
      return this.notFound(request, env);
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
    if (path === "/api/ebay-listings")
      return headersFor(
        Response.json(
          { error: "This catalog endpoint is retired." },
          { status: 410, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } },
        ),
        path,
      );
    if (path === "/api/print-products") {
      try {
        return headersFor(
          Response.json(await readPrintProducts(env), { headers: { "Cache-Control": "no-store" } }),
          path,
        );
      } catch {
        return headersFor(
          Response.json(
            { error: "Printed products are temporarily unavailable." },
            { status: 503, headers: { "Cache-Control": "no-store" } },
          ),
          path,
        );
      }
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
      [
        "/",
        "/all-artwork.html",
        "/genre.html",
        "/canvases.html",
        "/apparel.html",
        "/art.html",
      ].includes(path)
    ) {
      assetHeaders.delete("if-none-match");
      assetHeaders.delete("if-modified-since");
    }
    const response = await env.ASSETS.fetch(
      new Request(assetUrl, { method: request.method, headers: assetHeaders }),
    );
    if (response.status === 404) return this.notFound(request, env);

    if (path === "/art.html" && response.ok) {
      try {
        const rows = await readPublishedArtworks(SUPABASE_URL, SUPABASE_ANON_KEY, {
          fetcher: env.CATALOG_FETCH || fetch,
          signal: AbortSignal.timeout(6000),
        });
        const row = rows.find((x) => String(x.id) === url.searchParams.get("id"));
        if (!row) return this.notFound(request, env);
        let content = await response.text();
        content = content.replace(/<section[^>]*id="art-detail-root"[\s\S]*?<\/section>/, () =>
          renderArtworkDetail(row),
        );
        content = content.replace(
          "<!--ART_BOOTSTRAP-->",
          () =>
            `<script id="catalog-bootstrap" type="application/json">${JSON.stringify({ rows: [row] }).replace(/</g, "\\u003c")}</script>`,
        );
        const title = escapeHtml(row.title + " | Pixel Shroom Studio"),
          canonical = CANONICAL + "/art.html?id=" + row.id;
        const description = escapeHtml(
          `Explore ${row.title} by ${row.artist || "LWVader"}. View its protected preview, registered serial, file details and available purchase paths.`,
        );
        content = content
          .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${title}</title>`)
          .replace(/(<link rel="canonical" href=")[^"]+/, (_, a) => a + canonical);
        content = content.replace(
          /(<meta\s+(?:name="description"|property="og:description"|name="twitter:description")\s+content=")[^"]*/g,
          (_, a) => a + description,
        );
        content = content.replace(
          /(<meta\s+(?:property="og:title"|name="twitter:title")\s+content=")[^"]*/g,
          (_, a) => a + title,
        );
        content = content.replace(
          /(<meta\s+property="og:url"\s+content=")[^"]*/g,
          (_, a) => a + canonical,
        );
        const schema = {
          "@context": "https://schema.org",
          "@type": "VisualArtwork",
          name: row.title,
          identifier: row.serial_number,
          url: canonical,
          image: row.preview_url,
          genre: row.category,
          creator: { "@type": "Person", name: row.artist || "LWVader" },
        };
        content = content
          .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, "")
          .replace(
            "</head>",
            () =>
              `<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, "\\u003c")}</script></head>`,
          );
        const headers = new Headers(response.headers);
        headers.delete("etag");
        headers.delete("last-modified");
        headers.delete("content-length");
        return headersFor(new Response(content, { status: 200, headers }), path);
      } catch {
        return headersFor(
          new Response("Artwork is temporarily unavailable. Please try again.", {
            status: 503,
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              "Cache-Control": "no-store",
              "X-Robots-Tag": "noindex",
            },
          }),
          path,
        );
      }
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
        const term =
          path === "/all-artwork.html"
            ? (url.searchParams.get("q") || "").trim().slice(0, 160)
            : "";
        const matches = term
          ? rows.filter((x) =>
              `${x.title} ${x.artist} ${x.category} ${x.serial_number}`
                .toLowerCase()
                .includes(term.toLowerCase()),
            )
          : rows;
        const markup = term
          ? matches.map((x) => cardMarkup(x)).join("") || "<p>No artwork matches this search.</p>"
          : slug
            ? renderGenre(rows, slug)
            : path === "/"
              ? renderLatest(rows)
              : renderCompiled(rows);
        if (term)
          content = content
            .replace(/(<div id="catalog"[^>]*class=")[^"]*/, (_, a) => a + "art-grid")
            .replace('content="index,follow,max-image-preview:large"', 'content="noindex,follow"');
        content = content.replace(
          /<!--CATALOG_START-->[\s\S]*?<!--CATALOG_END-->/,
          "<!--CATALOG_START-->" + markup + "<!--CATALOG_END-->",
        );
        if (path === "/") {
          content = content.replace(
            /<!--FEATURED_START-->[\s\S]*?<!--FEATURED_END-->/,
            () => `<!--FEATURED_START-->${renderFeatured(cachedRows)}<!--FEATURED_END-->`,
          );
          content = content.replace(
            /<!--PROJECT_EXAMPLE_START-->[\s\S]*?<!--PROJECT_EXAMPLE_END-->/,
            () =>
              `<!--PROJECT_EXAMPLE_START-->${renderProjectExample(cachedRows)}<!--PROJECT_EXAMPLE_END-->`,
          );
        }
        const payload = JSON.stringify({
          rows: path === "/" ? cachedRows : rows,
          genre: slug,
          loadedAt: cachedAt,
        }).replace(/</g, "\\u003c");
        content = content.replace(
          "<!--BOOTSTRAP-->",
          `<script id="catalog-bootstrap" type="application/json">${payload}</script>`,
        );
        content = content
          .replace(
            "Checking current published listings…",
            path === "/"
              ? `${rows.length} recent artworks. Newest first.`
              : term
                ? `${matches.length} artworks match your search.`
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
      if (path === "/") {
        let products = null,
          timer;
        try {
          products = await Promise.race([
            readPrintProducts(env),
            new Promise((resolve) => {
              timer = setTimeout(() => resolve(null), 1500);
            }),
          ]);
        } catch {
        } finally {
          clearTimeout(timer);
        }
        content = content.replace(
          /<!--PRODUCT_EXAMPLES_START-->[\s\S]*?<!--PRODUCT_EXAMPLES_END-->/,
          () =>
            `<!--PRODUCT_EXAMPLES_START-->${renderProductExamples(products)}<!--PRODUCT_EXAMPLES_END-->`,
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
      if (path === "/all-artwork.html" && url.searchParams.get("q"))
        h.set("X-Robots-Tag", "noindex,follow");
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
