// SECTION: Genre route definitions and page metadata
const genres = {
  portrait: ["Portrait", "Explore protected AI portraits from independent artists."],
  fantasy: ["Fantasy", "Discover imagined worlds, magical beings, and protected fantasy artwork."],
  landscape: ["Landscape", "Browse protected natural and imagined landscapes."],
  "sci-fi": ["Sci-Fi", "Explore future worlds, technology, and science-fiction artwork."],
  abstract: ["Abstract", "Discover expressive color, geometry, and abstract AI originals."],
  dreamscape: ["Dreamscape", "Browse surreal dreams and atmospheric imagined scenes."],
  nft: ["NFT", "Place an NFT order securely. After verified payment, the complete ZIP package is manually sent to your email."]
};
// SECTION: Safe markup and artwork preview rendering
const escapeHtml = (value) => String(value ?? "").replace(
  /[&<>'"]/g,
  (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]
);
const slug = location.pathname.split("/").filter(Boolean).pop() || "portrait";
const entry = genres[slug];
if (!entry) {
  location.replace("/");
}
const [title, description] = entry || genres.portrait;
document.title = `${title} Art \u2014 Pixel Shroom Studio`;
document.querySelector("#genre-title").textContent = title;
document.querySelector("#genre-crumb").textContent = title;
document.querySelector("#genre-description").textContent = description;
document.querySelector("#genre-tabs").innerHTML = Object.entries(genres).map(([key, value]) => `<a class="${key === slug ? "active" : ""}" href="/genre/${key}">${value[0]}</a>`).join("");
function artworkPreview(item) {
  const image = item.previewUrl ? `<img src="${escapeHtml(item.previewUrl)}" alt="${escapeHtml(item.title)} watermarked preview">` : "";
  return `<div class="art-preview" style="max-width:${item.displayWidth}px;height:${item.displayHeight}px">
    ${image}
    <div class="watermark" aria-hidden="true">
      ${Array.from({ length: 8 }, () => "<span>PIXEL SHROOM STUDIO \u2022 PREVIEW \u2022 LICENSE REQUIRED</span>").join("")}
    </div>
  </div>`;
}
// SECTION: Standard-art and NFT-specific purchase controls
function purchaseControl(item) {
  if (item.category === "NFT") {
    return `<form class="nft-order-form" data-id="${item.id}">
      <label>Delivery email
        <input name="buyerEmail" type="email" placeholder="buyer@example.com" required>
      </label>
      <select name="provider" aria-label="Payment provider">
        <option value="stripe">Stripe</option>
        <option value="paypal">PayPal</option>
      </select>
      <button type="submit" class="buy-button">Order NFT package</button>
      <small>The ZIP package is manually emailed after verified payment.</small>
    </form>`;
  }
  return `<button class="buy-button" data-buy="${item.id}">License artwork</button>`;
}
function artworkCard(item) {
  return `<article class="art-card">
    ${artworkPreview(item)}
    <div class="card-info">
      <div>
        <p>${escapeHtml(item.category)} \xB7 ${escapeHtml(item.serialNumber)}</p>
        <h3>${escapeHtml(item.title)}</h3>
        <span>by ${escapeHtml(item.artist)}</span>
      </div>
      <strong>$${Number(item.price).toFixed(2)}</strong>
    </div>
    ${purchaseControl(item)}
  </article>`;
}
async function createOrder(artworkId, provider, buyerEmail = "") {
  const response = await fetch("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ artworkId, provider, buyerEmail })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Order could not be created.");
  return result;
}
// SECTION: Genre catalog loading
async function load() {
  try {
    const response = await fetch(`/api/artworks?category=${encodeURIComponent(title)}`);
    const items = await response.json();
    document.querySelector("#genre-count").textContent = `${items.length} ${title} listing${items.length === 1 ? "" : "s"}`;
    document.querySelector("#genre-catalog").innerHTML = items.length ? items.map(artworkCard).join("") : `<div class="empty"><h2>No listings yet</h2><p>The ${escapeHtml(title.toLowerCase())} collection is being prepared.</p></div>`;
  } catch {
    document.querySelector("#genre-catalog").innerHTML = '<div class="empty"><h2>Collection unavailable</h2></div>';
  }
}
// SECTION: NFT email-order submission
document.querySelector("#genre-catalog").addEventListener("submit", async (event) => {
  const form = event.target.closest(".nft-order-form");
  if (!form) return;
  event.preventDefault();
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const data = new FormData(form);
    const result = await createOrder(Number(form.dataset.id), data.get("provider"), data.get("buyerEmail"));
    alert(result.message);
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
});
// SECTION: Standard artwork checkout and image deterrents
document.querySelector("#genre-catalog").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-buy]");
  if (!button) return;
  button.disabled = true;
  try {
    const result = await createOrder(Number(button.dataset.buy), "stripe");
    alert(result.message);
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
});
document.addEventListener("contextmenu", (event) => {
  if (event.target.closest("img,.art-preview")) event.preventDefault();
});
load();
