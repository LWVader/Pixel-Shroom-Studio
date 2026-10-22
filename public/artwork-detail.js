import { readPublishedArtworks, validRows } from "./catalog-core.js?v=20261022-layout";
import { renderArtworkDetail } from "./artwork-page-core.js?v=20261022-layout";
import { safeArtworkId } from "./forge-print-core.js?v=20261022-layout";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
const params = new URLSearchParams(location.search),
  ids = params.getAll("id"),
  root = document.querySelector("#art-detail-root");
if (ids.length !== 1 || !safeArtworkId(ids[0])) {
  if (root)
    root.innerHTML = '<h1>Choose an artwork.</h1><a href="/all-artwork.html">Explore gallery →</a>';
} else {
  try {
    let row;
    const bootstrap = document.querySelector("#catalog-bootstrap");
    if (bootstrap) row = validRows(JSON.parse(bootstrap.textContent).rows)[0];
    else {
      const rows = await readPublishedArtworks(SUPABASE_URL, SUPABASE_ANON_KEY, {
        signal: AbortSignal.timeout(15000),
      });
      row = rows.find((r) => String(r.id) === ids[0]);
      if (!row) throw Error("This artwork is unavailable.");
      if (root) root.outerHTML = renderArtworkDetail(row);
      const node = document.createElement("script");
      node.id = "catalog-bootstrap";
      node.type = "application/json";
      node.textContent = JSON.stringify({ rows: [row] });
      document.body.append(node);
    }
    if (!row || String(row.id) !== ids[0]) throw Error("This artwork is unavailable.");
    document.title = `${row.title} | Pixel Shroom Studio`;
    document.querySelector('link[rel="canonical"]').href =
      `https://www.pixelshroomstudio.com/art.html?id=${encodeURIComponent(row.id)}`;
    await import("./app.js?v=20261022-layout");
    await import("./forge-print.js?v=20261022-layout");
  } catch {
    if (root)
      root.innerHTML =
        '<h1>Artwork temporarily unavailable.</h1><p>Please try again or explore a collection.</p><a href="/all-artwork.html">Explore gallery →</a>';
  }
}
