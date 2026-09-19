import { invoke, mapArtwork, supabase } from "./supabase-client.js";

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
const slug = new URLSearchParams(location.search).get("genre") || "portrait";
const entry = genres[slug];
if (!entry) {
  location.replace("/genre.html?genre=portrait");
}
const [title, description] = entry || genres.portrait;
document.title = `${title} Art \u2014 Pixel Shroom Studio`;
document.querySelector("#genre-title").textContent = title;
document.querySelector("#genre-crumb").textContent = title;
document.querySelector("#genre-description").textContent = description;
document.querySelector("#genre-tabs").innerHTML = Object.entries(genres).map(([key, value]) => `<a class="${key === slug ? "active" : ""}" href="/genre.html?genre=${encodeURIComponent(key)}">${value[0]}</a>`).join("");
function artworkPreview(item) {
  const image = item.previewUrl ? `<img src="${escapeHtml(item.previewUrl)}" alt="${escapeHtml(item.title)} watermarked preview">` : "";
  return `<button class="art-preview preview-trigger" type="button" data-preview-url="${escapeHtml(item.previewUrl || "")}" data-preview-title="${escapeHtml(item.title)}" data-preview-serial="${escapeHtml(item.serialNumber)}" style="max-width:${item.displayWidth}px;height:${item.displayHeight}px" aria-label="Enlarge protected preview of ${escapeHtml(item.title)}">
    ${image}
    <div class="watermark" aria-hidden="true">
      ${Array.from({ length: 8 }, () => "<span>PIXEL SHROOM STUDIO \u2022 PREVIEW \u2022 LICENSE REQUIRED</span>").join("")}
    </div>
  </button>`;
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
  return `<div class="payment-actions">
    <button class="buy-button" data-buy="${item.id}" data-provider="stripe">Pay with Stripe</button>
    <button class="buy-button secondary" data-buy="${item.id}" data-provider="paypal">Pay with PayPal</button>
  </div>`;
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
  return invoke("create-checkout", { artworkId, provider, buyerEmail });
}
// SECTION: Genre catalog loading
async function load() {
  try {
    const { data, error } = await supabase.from("artworks").select("*").eq("status", "published").eq("category", title).order("created_at", { ascending: false });
    if (error) throw error;
    const items = data.map(mapArtwork);
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
    location.assign(result.checkoutUrl);
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
});
// SECTION: Standard artwork checkout and image deterrents
document.querySelector("#genre-catalog").addEventListener("click", async (event) => {
  const previewTrigger = event.target.closest(".preview-trigger");
  if (previewTrigger) {
    openLargePreview(previewTrigger);
    return;
  }
  const button = event.target.closest("[data-buy]");
  if (!button) return;
  button.disabled = true;
  try {
    const result = await createOrder(Number(button.dataset.buy), button.dataset.provider || "stripe");
    location.assign(result.checkoutUrl);
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
});
// SECTION: Accessible large protected-preview dialog controls
const previewDialog = document.querySelector("#image-preview-dialog");
function openLargePreview(trigger) {
  if (!trigger.dataset.previewUrl) return;
  const image = document.querySelector("#large-preview-image");
  const frame = document.querySelector("#large-preview-frame");
  const overlay = document.querySelector("#large-art-preview .large-watermark");
  document.querySelector("#preview-dialog-title").textContent = trigger.dataset.previewTitle;
  document.querySelector("#preview-dialog-serial").textContent = `Serial: ${trigger.dataset.previewSerial} \u00B7 Watermarked preview only`;
  overlay.innerHTML = Array.from({ length: 14 }, () => "<span>PIXEL SHROOM STUDIO \u2022 PROTECTED PREVIEW \u2022 PIXEL SHROOM STUDIO \u2022 PROTECTED PREVIEW</span>").join("");
  overlay.hidden = true;
  frame.removeAttribute("style");
  image.onload = () => sizeLargePreviewFrame(image, frame);
  image.src = trigger.dataset.previewUrl;
  image.alt = `${trigger.dataset.previewTitle} enlarged watermarked preview`;
  previewDialog.showModal();
  if (image.complete && image.naturalWidth) sizeLargePreviewFrame(image, frame);
}
function sizeLargePreviewFrame(image, frame) {
  const container = document.querySelector("#large-art-preview");
  const maximumWidth = container.clientWidth;
  const maximumHeight = Math.floor(window.innerHeight * 0.72);
  const scale = Math.min(maximumWidth / image.naturalWidth, maximumHeight / image.naturalHeight);
  frame.style.width = `${Math.max(1, Math.round(image.naturalWidth * scale))}px`;
  frame.style.height = `${Math.max(1, Math.round(image.naturalHeight * scale))}px`;
}
document.querySelector("#close-preview-dialog").addEventListener("click", () => previewDialog.close());
previewDialog.addEventListener("click", (event) => {
  if (event.target === previewDialog) previewDialog.close();
});
window.addEventListener("resize", () => {
  if (!previewDialog.open) return;
  sizeLargePreviewFrame(document.querySelector("#large-preview-image"), document.querySelector("#large-preview-frame"));
});
document.addEventListener("contextmenu", (event) => {
  if (event.target.closest("img,.art-preview")) event.preventDefault();
});
load();
