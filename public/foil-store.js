import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { editionActionsMarkup } from "./catalog-core.js?v=20261022-loop";
let editions = [];
export function applyFoilListings() {
  for (const card of document.querySelectorAll(".art-card[data-artwork-id]")) {
    const edition = editions.find((item) => String(item.artworkId) === card.dataset.artworkId);
    if (!edition) continue;
    const actions = card.querySelector(".payment-actions");
    if (!actions) continue;
    actions.innerHTML = editionActionsMarkup(edition);
    actions.hidden = false;
    const verify = card.querySelector(".verify-link");
    if (verify) {
      verify.href = "/verify-mint.html";
      verify.textContent = "How edition verification works →";
    }
    const price = card.querySelector(".price");
    if (price)
      price.textContent = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(Number(edition.price));
    card.querySelector(".artwork-information")?.setAttribute("hidden", "");
    // Original dimensions describe the master; tier dimensions are available before purchase and confirmed after delivery.
    const size = card.querySelector(".artwork-size");
    if (size) size.textContent = size.textContent.replace("Original image:", "Preview source:");
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
