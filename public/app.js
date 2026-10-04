import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import {
  GENRES,
  randomSample,
  readPublishedArtworks,
  renderCompiled,
  renderLatest,
  latestArtworks,
  renderGenre,
  validRows,
  escapeHtml,
  checkoutUrl,
} from "./catalog-core.js?v=20261004-collections";
const catalog = document.querySelector("#catalog"),
  search = document.querySelector("#search"),
  status = document.querySelector("#catalog-status");
const mode = catalog?.dataset.mode,
  slug = catalog?.dataset.genre;
let rows = [],
  sampleIds = {};
function chooseSamples() {
  sampleIds = Object.fromEntries(
    Object.entries(GENRES).map(([s, g]) => [
      s,
      randomSample(
        rows.filter((x) => x.category === g.name),
        4,
      ).map((x) => String(x.id)),
    ]),
  );
}
function enableActions() {
  catalog?.querySelectorAll(".payment-actions").forEach((x) => {
    x.hidden = false;
  });
}
function render() {
  if (!catalog) return;
  const term = search?.value || "";
  catalog.innerHTML =
    mode === "compiled"
      ? renderCompiled(rows, { term, sampleIds: term.trim() ? undefined : sampleIds })
      : mode === "latest"
        ? renderLatest(rows, { term })
        : renderGenre(rows, slug, { term });
  enableActions();
  catalog.setAttribute("aria-busy", "false");
  const relevant =
    mode === "genre"
      ? rows.filter((x) => x.category === GENRES[slug]?.name)
      : mode === "latest"
        ? latestArtworks(rows)
        : rows;
  const q = term.trim().toLowerCase(),
    matches = relevant.filter((x) =>
      `${x.title} ${x.artist} ${x.category} ${x.serial_number}`.toLowerCase().includes(q),
    );
  status.textContent =
    mode === "compiled"
      ? `${matches.length} published listing${matches.length === 1 ? "" : "s"}${q ? " match your search" : ""}. Showing up to four per genre.`
      : mode === "latest"
        ? `${matches.length} recent artwork${matches.length === 1 ? "" : "s"}${q ? " match your search" : ""}. Newest first.`
        : `${matches.length} ${GENRES[slug]?.name || ""} listing${matches.length === 1 ? "" : "s"}${q ? " match your search" : ""}.`;
}
async function loadCatalog() {
  if (!catalog) return;
  try {
    const bootstrap = document.querySelector("#catalog-bootstrap");
    if (bootstrap) {
      const data = JSON.parse(bootstrap.textContent);
      rows = validRows(data.rows);
      sampleIds = Object.fromEntries(
        [...catalog.querySelectorAll("[data-genre-section]")].map((section) => [
          section.dataset.genreSection,
          [...section.querySelectorAll("[data-artwork-id]")].map((c) => c.dataset.artworkId),
        ]),
      );
      if (!Object.keys(sampleIds).length) chooseSamples();
    } else {
      rows = await readPublishedArtworks(SUPABASE_URL, SUPABASE_ANON_KEY, {
        signal: AbortSignal.timeout(15000),
      });
      chooseSamples();
    }
    render();
    const shuffle = document.querySelector("#shuffle-samples");
    if (shuffle) shuffle.hidden = !rows.length;
  } catch {
    rows = [];
    catalog.setAttribute("aria-busy", "false");
    catalog.innerHTML =
      mode === "compiled"
        ? renderCompiled([])
        : '<div class="empty"><h2>Collection temporarily unavailable</h2><p>Please try again or contact the studio.</p><a class="text-link" href="/contact.html">Contact LWVader →</a></div>';
    status.textContent = "The live collection could not be loaded. Please try again shortly.";
  }
}
search?.addEventListener("input", render);
document.querySelector("#shuffle-samples")?.addEventListener("click", () => {
  chooseSamples();
  render();
});
for (const a of document.querySelectorAll(".category-nav a")) {
  if (slug && new URL(a.href).searchParams.get("genre") === slug)
    a.setAttribute("aria-current", "page");
  else if (a.pathname === "/all-artwork.html" && location.pathname === "/all-artwork.html")
    a.setAttribute("aria-current", "page");
  else if (!slug && location.pathname === "/faq.html" && a.pathname === "/faq.html")
    a.setAttribute("aria-current", "page");
}
catalog?.addEventListener("click", async (event) => {
  const preview = event.target.closest(".preview-trigger");
  if (preview) {
    openPreview(preview);
    return;
  }
  const button = event.target.closest("[data-buy]");
  if (!button) return;
  const row = rows.find((x) => String(x.id) === button.dataset.buy),
    provider = button.dataset.provider,
    card = button.closest(".art-card"),
    message = card.querySelector(".card-status"),
    buttons = card.querySelectorAll("[data-buy]");
  if (!row || row.category === "NFT" || !["stripe", "paypal"].includes(provider)) {
    message.textContent = "This artwork is not available for purchase.";
    return;
  }
  buttons.forEach((b) => (b.disabled = true));
  message.textContent = "Opening secure checkout…";
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ artworkId: row.id, provider }),
      signal: AbortSignal.timeout(20000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(result.error || "Checkout could not be opened. Please contact the studio.");
    location.assign(checkoutUrl(result.checkoutUrl, provider));
  } catch (error) {
    message.textContent = error.message || "Checkout could not be opened.";
    buttons.forEach((b) => (b.disabled = false));
  }
});
let dialog;
function openPreview(trigger) {
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.className = "preview-dialog";
    dialog.setAttribute("aria-labelledby", "preview-title");
    dialog.innerHTML =
      '<button type="button" aria-label="Close artwork preview">Close ×</button><h2 id="preview-title"></h2><img alt=""><p></p>';
    document.body.append(dialog);
    dialog.querySelector("button").onclick = () => dialog.close();
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) dialog.close();
    });
  }
  dialog.querySelector("h2").textContent = trigger.dataset.title;
  dialog.querySelector("img").src = trigger.dataset.image;
  dialog.querySelector("img").alt = trigger.dataset.title + " enlarged protected preview";
  dialog.querySelector("p").textContent = trigger.dataset.serial + " · Protected public preview";
  dialog.showModal();
}
async function loadArticles() {
  const articles = document.querySelector("#articles");
  if (!articles) return;
  try {
    const query = new URLSearchParams({
      select: "title,excerpt,body",
      status: "eq.published",
      order: "created_at.desc",
      limit: "6",
    });
    const response = await fetch(`${SUPABASE_URL}/rest/v1/articles?${query}`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error();
    const list = await response.json();
    if (!Array.isArray(list)) throw new Error();
    articles.innerHTML = list.length
      ? list
          .map(
            (a) =>
              `<article><p class="eyebrow">Studio journal</p><h3>${escapeHtml(a.title)}</h3><p>${escapeHtml(a.excerpt)}</p><details><summary>Read article</summary><div class="article-body">${escapeHtml(a.body)}</div></details></article>`,
          )
          .join("")
      : '<p class="muted">Studio articles are being prepared.</p>';
  } catch {
    articles.innerHTML =
      '<p class="muted">The journal is temporarily unavailable. You can still explore the artwork.</p>';
  } finally {
    articles.setAttribute("aria-busy", "false");
  }
}
// Independent failures: an unavailable journal must not disable the collection.
await Promise.allSettled([loadCatalog(), loadArticles()]);
