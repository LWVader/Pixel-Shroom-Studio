import { invoke, mapArtwork, supabase } from "./supabase-client.js";
const genres = [["portrait", "Portrait"], ["fantasy", "Fantasy"], ["landscape", "Landscape"], ["sci-fi", "Sci-Fi"], ["abstract", "Abstract"], ["dreamscape", "Dreamscape"], ["nft", "NFT"]];
const catalog = document.querySelector("#catalog"), count = document.querySelector("#catalog-count"), search = document.querySelector("#search");
let artworks = [];
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const genreUrl = (slug) => `/genre.html?genre=${encodeURIComponent(slug)}`;
function previewMarkup(item) { return `<div class="art-preview" style="max-width:${item.displayWidth}px;height:${item.displayHeight}px">${item.previewUrl ? `<img src="${escapeHtml(item.previewUrl)}" alt="${escapeHtml(item.title)} watermarked preview">` : ""}</div>`; }
function cardMarkup(item) {
  const action = item.category === "NFT" ? `<a class="buy-button" href="${genreUrl("nft")}">Order NFT by email</a>` : `<button class="buy-button" data-id="${item.id}">License artwork</button>`;
  return `<article class="art-card">${previewMarkup(item)}<div class="card-info"><div><p>${escapeHtml(item.category)} · ${escapeHtml(item.serialNumber)}</p><h3>${escapeHtml(item.title)}</h3><span>by ${escapeHtml(item.artist)}</span></div><strong>$${item.price.toFixed(2)}</strong></div>${action}</article>`;
}
function render() {
  const term = search.value.trim().toLowerCase(), visible = artworks.filter((item) => `${item.title} ${item.artist} ${item.category} ${item.serialNumber}`.toLowerCase().includes(term));
  count.textContent = `${visible.length} available listing${visible.length === 1 ? "" : "s"}`;
  catalog.innerHTML = visible.length ? visible.map(cardMarkup).join("") : '<div class="empty"><h2>No matching artwork</h2><p>Try another title, artist, or genre.</p></div>';
}
function genreLinks() {
  const links = genres.map(([slug, label]) => `<a href="${genreUrl(slug)}">${label}</a>`).join("");
  document.querySelector("#categories").innerHTML = `<a href="#gallery">All artwork</a>${links}`;
  document.querySelector("#footer-genres").innerHTML = links;
}
function renderArticles(articles) { document.querySelector("#articles").innerHTML = articles.map((article) => `<article><span>ARTICLE</span><h3>${escapeHtml(article.title)}</h3><p>${escapeHtml(article.excerpt)}</p><details><summary>Read article</summary><div>${escapeHtml(article.body)}</div></details></article>`).join("") || "<p>No articles yet.</p>"; }
async function load() {
  try {
    const [artResult, articleResult] = await Promise.all([supabase.from("artworks").select("*").eq("status", "published").order("created_at", { ascending: false }), supabase.from("articles").select("title,excerpt,body").eq("status", "published").order("created_at", { ascending: false })]);
    if (artResult.error) throw artResult.error;
    if (articleResult.error) throw articleResult.error;
    artworks = artResult.data.map(mapArtwork); renderArticles(articleResult.data); genreLinks(); render();
  } catch (error) { console.error(error); catalog.innerHTML = '<div class="empty"><h2>Catalog unavailable</h2><p>Check public/config.js and the Supabase setup.</p></div>'; count.textContent = "Unavailable"; }
}
search.addEventListener("input", render);
catalog.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-id]"); if (!button) return;
  const original = button.textContent; button.disabled = true; button.textContent = "Starting secure checkout…";
  try { const result = await invoke("create-checkout", { artworkId: Number(button.dataset.id), provider: "stripe" }); location.assign(result.checkoutUrl); }
  catch (error) { alert(error.message); }
  finally { button.disabled = false; button.textContent = original; }
});
document.addEventListener("contextmenu", (event) => { if (event.target.closest("img,.art-preview")) event.preventDefault(); });
document.addEventListener("dragstart", (event) => { if (event.target.closest("img")) event.preventDefault(); });
load();
