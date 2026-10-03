// SECTION: Public storefront configuration and state
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config.js";

const catalog = document.querySelector("#catalog");
const count = document.querySelector("#catalog-count");
const search = document.querySelector("#search");
const articlesContainer = document.querySelector("#articles");
let artworks = [];

// SECTION: Lightweight public HTTP client
// The storefront uses direct REST requests instead of loading the full
// Supabase browser SDK and its dependency chain.
const publicHeaders = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
};

async function readTable(table, query) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    headers: publicHeaders,
  });
  if (!response.ok) throw new Error(`Unable to load ${table} (${response.status}).`);
  return response.json();
}

async function invoke(functionName, body) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
    method: "POST",
    headers: { ...publicHeaders, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

// SECTION: Safe catalog markup and data mapping
const escapeHtml = (value) => String(value ?? "").replace(
  /[&<>'"]/g,
  (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character],
);

const genreUrl = (slug) => `/genre.html?genre=${encodeURIComponent(slug)}`;

function mapArtwork(row) {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    category: row.category,
    serialNumber: row.serial_number,
    price: Number(row.price),
    previewUrl: row.preview_url,
    displayWidth: Number(row.display_width) || 600,
    displayHeight: Number(row.display_height) || 250,
  };
}

function previewMarkup(item) {
  const width = Math.max(1, item.displayWidth);
  const height = Math.max(1, item.displayHeight);
  const image = item.previewUrl
    ? `<img src="${escapeHtml(item.previewUrl)}" width="${width}" height="${height}" loading="lazy" decoding="async" alt="${escapeHtml(item.title)} watermarked preview">`
    : "";
  return `<div class="art-preview" style="--preview-ratio:${width}/${height}">${image}</div>`;
}

function cardMarkup(item) {
  const action = item.category === "NFT"
    ? `<a class="buy-button" href="${genreUrl("nft")}">Order NFT by email</a>`
    : `<button class="buy-button" data-id="${item.id}">Buy Artwork</button>`;
  return `<article class="art-card">${previewMarkup(item)}<div class="card-info"><div><p>${escapeHtml(item.category)} · ${escapeHtml(item.serialNumber)}</p><h3>${escapeHtml(item.title)}</h3><span>by ${escapeHtml(item.artist)}</span></div><strong>$${item.price.toFixed(2)}</strong></div>${action}</article>`;
}

// SECTION: Catalog and editorial rendering
function renderCatalog() {
  const term = search.value.trim().toLowerCase();
  const visible = artworks.filter((item) => (
    `${item.title} ${item.artist} ${item.category} ${item.serialNumber}`
      .toLowerCase()
      .includes(term)
  ));

  count.textContent = `${visible.length} available listing${visible.length === 1 ? "" : "s"}`;
  catalog.classList.remove("catalog-loading");
  catalog.setAttribute("aria-busy", "false");
  catalog.innerHTML = visible.length
    ? visible.map(cardMarkup).join("")
    : '<div class="empty"><h2>No matching artwork</h2><p>Try another title, artist, or genre.</p></div>';
}

function renderArticles(articles) {
  articlesContainer.setAttribute("aria-busy", "false");
  articlesContainer.innerHTML = articles.length
    ? articles.map((article) => `<article><span>ARTICLE</span><h3>${escapeHtml(article.title)}</h3><p>${escapeHtml(article.excerpt)}</p><details><summary>Read article</summary><div>${escapeHtml(article.body)}</div></details></article>`).join("")
    : "<p>No articles yet.</p>";
}

// SECTION: Parallel storefront data loading
async function loadStorefront() {
  try {
    const [artRows, articleRows] = await Promise.all([
      readTable(
        "artworks",
        "?select=id,title,artist,category,serial_number,price,preview_url,display_width,display_height&status=eq.published&order=created_at.desc&limit=6",
      ),
      readTable(
        "articles",
        "?select=title,excerpt,body&status=eq.published&order=created_at.desc",
      ),
    ]);

    artworks = artRows.map(mapArtwork);
    renderArticles(articleRows);
    renderCatalog();
  } catch (error) {
    console.error(error);
    catalog.classList.remove("catalog-loading");
    catalog.setAttribute("aria-busy", "false");
    catalog.innerHTML = '<div class="empty"><h2>Catalog unavailable</h2><p>Please try again shortly.</p></div>';
    count.textContent = "Unavailable";
    renderArticles([]);
  }
}

// SECTION: Search, checkout, and image deterrents
search.addEventListener("input", renderCatalog);

catalog.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-id]");
  if (!button) return;

  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Starting secure checkout…";

  try {
    const result = await invoke("create-checkout", {
      artworkId: Number(button.dataset.id),
      provider: "stripe",
    });
    location.assign(result.checkoutUrl);
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
});

document.addEventListener("contextmenu", (event) => {
  if (event.target.closest("img,.art-preview")) event.preventDefault();
});

document.addEventListener("dragstart", (event) => {
  if (event.target.closest("img")) event.preventDefault();
});

loadStorefront();
