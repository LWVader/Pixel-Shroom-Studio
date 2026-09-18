// SECTION: Storefront catalog configuration and DOM state
const genres = [["portrait", "Portrait"], ["fantasy", "Fantasy"], ["landscape", "Landscape"], ["sci-fi", "Sci-Fi"], ["abstract", "Abstract"], ["dreamscape", "Dreamscape"], ["nft", "NFT"]];
const catalog = document.querySelector("#catalog"), count = document.querySelector("#catalog-count"), search = document.querySelector("#search");
let artworks = [];
// SECTION: Temporary editorial testing content
const sampleArticles = [
  { title: "Collecting Beyond the Screen", excerpt: "A testing note about choosing digital artwork with intention.", body: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer vitae justo sed arcu luctus placerat. Curabitur posuere, nibh at tristique viverra, lorem neque tempus mauris, sed feugiat magna velit in sem." },
  { title: "Inside a Protected Release", excerpt: "Placeholder copy for testing longer editorial summaries and scrolling.", body: "Praesent commodo, augue sed consequat volutpat, nisl sapien malesuada tellus, sed fermentum libero arcu sit amet erat. Donec pulvinar dignissim sem, vitae volutpat nulla posuere non." },
  { title: "Color, Form, and Machine Imagination", excerpt: "Sample editorial text exploring visual themes in generated art.", body: "Suspendisse potenti. Morbi at lectus vel nibh faucibus feugiat. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas." },
  { title: "A Collector’s Guide to Licensing", excerpt: "Temporary content used to confirm the sidebar’s independent scrollbar.", body: "Aliquam erat volutpat. Vivamus egestas, lacus non pellentesque luctus, sapien libero faucibus mi, non dignissim augue justo sed nibh. Nulla facilisi." },
  { title: "Serial Identity in Digital Artwork", excerpt: "A placeholder article about artwork records and embedded serial numbers.", body: "Fusce tincidunt erat eget lacus interdum, sit amet malesuada odio luctus. Sed consequat lectus quis lacus gravida, nec luctus nibh vulputate." },
  { title: "Curating a Personal Digital Gallery", excerpt: "Additional sample copy keeps the editorial column ready for layout testing.", body: "Cras malesuada risus ut nibh aliquet, vel consequat tortor tincidunt. Proin quis mi eu velit tincidunt faucibus non sed turpis." }
];
// SECTION: Safe markup and protected artwork-card rendering
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
function previewMarkup(item) {
  const image = item.previewUrl ? `<img src="${escapeHtml(item.previewUrl)}" alt="${escapeHtml(item.title)} watermarked preview">` : "";
  return `<div class="art-preview" style="max-width:${item.displayWidth}px;height:${item.displayHeight}px">${image}<div class="watermark" aria-hidden="true">${Array.from({ length: 8 }, () => "<span>PIXEL SHROOM STUDIO \u2022 PREVIEW \u2022 LICENSE REQUIRED</span>").join("")}</div></div>`;
}
function cardMarkup(item) {
  const action = item.category === "NFT" ? '<a class="buy-button" href="/genre/nft">Order NFT by email</a>' : `<button class="buy-button" data-id="${item.id}">License artwork</button>`;
  return `<article class="art-card">${previewMarkup(item)}<div class="card-info"><div><p>${escapeHtml(item.category)} \xB7 ${escapeHtml(item.serialNumber)}</p><h3>${escapeHtml(item.title)}</h3><span>by ${escapeHtml(item.artist)}</span></div><strong>$${Number(item.price).toFixed(2)}</strong></div>${action}</article>`;
}
// SECTION: Catalog filtering, genre navigation, and articles
function render() {
  const term = search.value.trim().toLowerCase(), visible = artworks.filter((item) => `${item.title} ${item.artist} ${item.category} ${item.serialNumber}`.toLowerCase().includes(term));
  count.textContent = `${visible.length} available listing${visible.length === 1 ? "" : "s"}`;
  catalog.innerHTML = visible.length ? visible.map(cardMarkup).join("") : '<div class="empty"><h2>No matching artwork</h2><p>Try another title, artist, or genre.</p></div>';
}
function genreLinks() {
  const links = genres.map(([slug, label]) => `<a href="/genre/${slug}">${label}</a>`).join("");
  document.querySelector("#categories").innerHTML = `<a href="#gallery">All artwork</a>${links}`;
  document.querySelector("#footer-genres").innerHTML = links;
}
function renderArticles(articles) {
  const editorialItems = articles.length ? articles : sampleArticles;
  document.querySelector("#articles").innerHTML = editorialItems.map((article) => `<article><span>${articles.length ? "ARTICLE" : "SAMPLE ARTICLE"}</span><h3>${escapeHtml(article.title)}</h3><p>${escapeHtml(article.excerpt)}</p><details><summary>Read article</summary><div>${escapeHtml(article.body)}</div></details></article>`).join("");
}
// SECTION: Storefront API loading
async function load() {
  try {
    const [artResponse, siteResponse] = await Promise.all([fetch("/api/artworks"), fetch("/api/site")]);
    if (!artResponse.ok || !siteResponse.ok) throw new Error();
    artworks = await artResponse.json();
    const site = await siteResponse.json();
    renderArticles(site.articles);
    genreLinks();
    render();
  } catch {
    catalog.innerHTML = '<div class="empty"><h2>Catalog unavailable</h2><p>Please try again shortly.</p></div>';
    count.textContent = "Unavailable";
  }
}
// SECTION: Search, checkout, and image-deterrent interactions
search.addEventListener("input", render);
catalog.addEventListener("click", async (event) => {
  const button = event.target.closest(".buy-button");
  if (!button) return;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Starting secure checkout\u2026";
  try {
    const response = await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ artworkId: Number(button.dataset.id), provider: "stripe" }) });
    const result = await response.json();
    alert(result.message || result.error);
  } catch {
    alert("Checkout is unavailable.");
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
});
document.addEventListener("contextmenu", (event) => {
  if (event.target.closest("img,.art-preview")) event.preventDefault();
});
document.addEventListener("dragstart", (event) => {
  if (event.target.closest("img")) event.preventDefault();
});
load();
