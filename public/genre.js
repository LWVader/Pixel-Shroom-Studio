// SECTION: Public database configuration
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config.js";

const GENRES = {
  portrait: ["Portrait", "Explore protected AI portraits and character artwork."],
  fantasy: ["Fantasy", "Discover imagined worlds, magical beings, and protected fantasy artwork."],
  landscape: ["Landscape", "Browse protected natural and imagined landscapes."],
  "sci-fi": ["Sci-Fi", "Explore future worlds, technology, and science-fiction artwork."],
  abstract: ["Abstract", "Discover expressive color, geometry, and abstract AI originals."],
  dreamscape: ["Dreamscape", "Browse surreal dreams and atmospheric imagined scenes."],
  "dark-fantasy": ["Dark Fantasy", "Explore supernatural worlds, gothic visions, and shadowed fantasy artwork."],
  horror: ["Horror", "Browse eerie, macabre, and cinematic horror artwork."],
  nft: ["NFT", "Order a serialized NFT package for secure manual delivery by email."],
};

const publicHeaders = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
};

// SECTION: Route parsing and page metadata
function requestedGenre() {
  const queryGenre = new URLSearchParams(location.search).get("genre");
  if (queryGenre) return queryGenre.toLowerCase();

  const pathPart = location.pathname.split("/").filter(Boolean).pop() || "portrait";
  return pathPart === "genre.html" ? "portrait" : pathPart.toLowerCase();
}

const slug = requestedGenre();
const genre = GENRES[slug];

if (!genre) {
  location.replace("/");
  throw new Error("Unknown genre.");
}

const [title, description] = genre;
const catalog = document.querySelector("#genre-catalog");
const previewDialog = document.querySelector("#image-preview-dialog");

document.title = `${title} Art — Pixel Shroom Studio`;
document.querySelector("#genre-title").textContent = title;
document.querySelector("#genre-crumb").textContent = title;
document.querySelector("#genre-description").textContent = description;
document.querySelector("#genre-tabs").innerHTML = Object.entries(GENRES)
  .map(([key, value]) => `<a class="${key === slug ? "active" : ""}" href="/genre.html?genre=${encodeURIComponent(key)}">${value[0]}</a>`)
  .join("");

// SECTION: Safe artwork mapping and compact cards matching the home page
const escapeHtml = (value) => String(value ?? "").replace(
  /[&<>'"]/g,
  (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character],
);

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
    displayHeight: Number(row.display_height) || 600,
  };
}

function previewMarkup(item) {
  const width = Math.max(1, item.displayWidth);
  const height = Math.max(1, item.displayHeight);
  const image = item.previewUrl
    ? `<img src="${escapeHtml(item.previewUrl)}" width="${width}" height="${height}" loading="lazy" decoding="async" alt="${escapeHtml(item.title)} watermarked preview">`
    : "";

  return `<button class="art-preview preview-trigger" type="button" data-preview-url="${escapeHtml(item.previewUrl || "")}" data-preview-title="${escapeHtml(item.title)}" data-preview-serial="${escapeHtml(item.serialNumber)}" aria-label="Enlarge protected preview of ${escapeHtml(item.title)}">${image}</button>`;
}

function purchaseMarkup(item) {
  if (item.category === "NFT") {
    return `<form class="nft-order-form" data-id="${item.id}">
      <label>Delivery email<input name="buyerEmail" type="email" autocomplete="email" placeholder="buyer@example.com" required></label>
      <button type="submit" class="buy-button">Order NFT package with Stripe</button>
      <small>The ZIP package is manually emailed after verified payment.</small>
    </form>`;
  }

  return `<button class="buy-button" type="button" data-buy="${item.id}">License artwork</button>`;
}

function cardMarkup(item) {
  return `<article class="art-card">
    ${previewMarkup(item)}
    <div class="card-info"><div><p>${escapeHtml(item.category)} · ${escapeHtml(item.serialNumber)}</p><h3>${escapeHtml(item.title)}</h3><span>by ${escapeHtml(item.artist)}</span></div><strong>$${item.price.toFixed(2)}</strong></div>
    ${purchaseMarkup(item)}
  </article>`;
}

// SECTION: REST and Edge Function requests
async function readArtwork() {
  const query = `?select=id,title,artist,category,serial_number,price,preview_url,display_width,display_height&status=eq.published&category=eq.${encodeURIComponent(title)}&order=created_at.desc`;
  const response = await fetch(`${SUPABASE_URL}/rest/v1/artworks${query}`, { headers: publicHeaders });
  if (!response.ok) throw new Error(`Unable to load artwork (${response.status}).`);
  return response.json();
}

async function createCheckout(artworkId, buyerEmail = "") {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout`, {
    method: "POST",
    headers: { ...publicHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ artworkId, provider: "stripe", buyerEmail }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Checkout failed (${response.status}).`);
  return result;
}

async function loadGenre() {
  try {
    const items = (await readArtwork()).map(mapArtwork);
    document.querySelector("#genre-count").textContent = `${items.length} ${title} listing${items.length === 1 ? "" : "s"}`;
    catalog.classList.remove("catalog-loading");
    catalog.setAttribute("aria-busy", "false");
    catalog.innerHTML = items.length
      ? items.map(cardMarkup).join("")
      : `<div class="empty"><h2>No listings yet</h2><p>The ${escapeHtml(title.toLowerCase())} collection is being prepared.</p></div>`;
  } catch (error) {
    console.error(error);
    catalog.classList.remove("catalog-loading");
    catalog.setAttribute("aria-busy", "false");
    catalog.innerHTML = '<div class="empty"><h2>Collection unavailable</h2><p>Please try again shortly.</p></div>';
  }
}

// SECTION: Checkout actions
catalog.addEventListener("click", async (event) => {
  const previewButton = event.target.closest(".preview-trigger");
  if (previewButton) {
    openLargePreview(previewButton);
    return;
  }

  const buyButton = event.target.closest("[data-buy]");
  if (!buyButton) return;

  buyButton.disabled = true;
  try {
    const result = await createCheckout(Number(buyButton.dataset.buy));
    location.assign(result.checkoutUrl);
  } catch (error) {
    alert(error.message);
    buyButton.disabled = false;
  }
});

catalog.addEventListener("submit", async (event) => {
  const form = event.target.closest(".nft-order-form");
  if (!form) return;
  event.preventDefault();

  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const values = new FormData(form);
    const result = await createCheckout(Number(form.dataset.id), String(values.get("buyerEmail") || ""));
    location.assign(result.checkoutUrl);
  } catch (error) {
    alert(error.message);
    button.disabled = false;
  }
});

// SECTION: Enlarged protected preview
function sizePreview(image, frame) {
  const container = document.querySelector("#large-art-preview");
  const scale = Math.min(container.clientWidth / image.naturalWidth, (window.innerHeight * 0.72) / image.naturalHeight, 1);
  frame.style.width = `${Math.max(1, Math.round(image.naturalWidth * scale))}px`;
  frame.style.height = `${Math.max(1, Math.round(image.naturalHeight * scale))}px`;
}

function openLargePreview(trigger) {
  if (!trigger.dataset.previewUrl) return;
  const image = document.querySelector("#large-preview-image");
  const frame = document.querySelector("#large-preview-frame");
  document.querySelector("#preview-dialog-title").textContent = trigger.dataset.previewTitle;
  document.querySelector("#preview-dialog-serial").textContent = `Serial: ${trigger.dataset.previewSerial} · Permanently watermarked preview`;
  image.onload = () => sizePreview(image, frame);
  image.src = trigger.dataset.previewUrl;
  image.alt = `${trigger.dataset.previewTitle} enlarged watermarked preview`;
  previewDialog.showModal();
  if (image.complete && image.naturalWidth) sizePreview(image, frame);
}

document.querySelector("#close-preview-dialog").addEventListener("click", () => previewDialog.close());
previewDialog.addEventListener("click", (event) => {
  if (event.target === previewDialog) previewDialog.close();
});
window.addEventListener("resize", () => {
  if (!previewDialog.open) return;
  sizePreview(document.querySelector("#large-preview-image"), document.querySelector("#large-preview-frame"));
});

// SECTION: Minor image-copy deterrents
document.addEventListener("contextmenu", (event) => {
  if (event.target.closest("img,.art-preview")) event.preventDefault();
});
document.addEventListener("dragstart", (event) => {
  if (event.target.closest("img")) event.preventDefault();
});

loadGenre();
