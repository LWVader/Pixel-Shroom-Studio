import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { editionDisclosure } from "./mint-core.js?v=20261019-six-tiers";
let editions = [];
export function applyFoilListings() {
  for (const card of document.querySelectorAll(".art-card[data-artwork-id]")) {
    const edition = editions.find((item) => String(item.artworkId) === card.dataset.artworkId);
    if (!edition) continue;
    const actions = card.querySelector(".payment-actions");
    if (!actions) continue;
    actions.replaceChildren();
    actions.hidden = false;
    const link = document.createElement("a");
    link.className = "button";
    link.href = `/collection.html?mint=${encodeURIComponent(edition.artworkId)}`;
    link.textContent = "Mint with Stripe ↗";
    const detail = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Foil edition: odds and delivery";
    const text = document.createElement("p");
    text.textContent =
      editionDisclosure(edition) +
      " Delivered as a private WebP variant with a signed receipt. The master file is not included. Existing usage permissions apply.";
    detail.append(summary, text);
    const progress = document.createElement("progress");
    progress.max = edition.maxSupply;
    progress.value = edition.totalMinted;
    progress.setAttribute("aria-label", "Paid edition allocations");
    const counter = document.createElement("p");
    counter.className = "foil-counter";
    counter.textContent = `${edition.totalMinted}/${edition.maxSupply} allocated · ${edition.prismaticsRemaining} Prismatics remaining · ${edition.reserved} checkout reservations`;
    actions.append(counter, progress, detail, link);
    const price = card.querySelector(".price");
    if (price)
      price.textContent = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(Number(edition.price));
    if (!edition.enabled || edition.totalMinted + edition.reserved >= edition.maxSupply) {
      link.removeAttribute("href");
      link.textContent = edition.enabled ? "Sold out or fully reserved" : "Minting paused";
      link.setAttribute("aria-disabled", "true");
    }
    card.querySelector(".artwork-information")?.setAttribute("hidden", "");
    // Original dimensions describe the master; variant dimensions appear after rendering.
    const size = card.querySelector(".artwork-size");
    if (size) size.textContent = size.textContent.replace("Original image:", "Master image:");
  }
}
export async function refreshFoilListings() {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/foil_catalog`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return;
    const result = await response.json();
    if (Array.isArray(result)) editions = result;
    applyFoilListings();
  } catch {
    /* Normal digital browsing remains usable while a mint feed is unavailable. */
  }
}
refreshFoilListings();
setInterval(() => {
  if (!document.hidden) refreshFoilListings();
}, 30000);
