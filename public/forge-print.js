import {
  TIER_FINISHES,
  PLANNED_OFFERS,
  forgeEstimate,
  offerSummary,
  readSelections,
  writeSelections,
  artUrl,
  money,
} from "./forge-print-core.js?v=20261024-portrait-v2";
import { readPublishedArtworks, validRows, escapeHtml } from "./catalog-core.js?v=20261022-loop";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
const searchInput = document.querySelector("#header-art-search");
if (searchInput)
  searchInput.value = (new URLSearchParams(location.search).get("q") || "").slice(0, 160);
function updateCartCount() {
  const count = readSelections(localStorage).length;
  document.querySelectorAll("[data-cart-count]").forEach((el) => (el.textContent = String(count)));
}
try {
  updateCartCount();
} catch {}
window.addEventListener("storage", () => {
  try {
    updateCartCount();
  } catch {}
});
document.querySelectorAll("[data-tier-finish]").forEach((button) => {
  button.disabled = false;
  button.addEventListener("click", () => {
    const tier = TIER_FINISHES.find((t) => t.tier === button.dataset.tierFinish);
    if (!tier) return;
    document
      .querySelectorAll("[data-tier-finish]")
      .forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
    document.querySelector("#finish-title").textContent = `${tier.tier} · ${tier.odds}%`;
    document.querySelector("#finish-format").textContent = tier.finish;
    document.querySelector("#finish-description").textContent = tier.detail;
  });
});
const calculator = document.querySelector("#forge-calculator");
if (calculator) calculator.querySelector('button[type="submit"]').disabled = false;
calculator?.addEventListener("submit", (event) => {
  event.preventDefault();
  const result = document.querySelector("#forge-estimate");
  try {
    const estimate = forgeEstimate(
      calculator.elements.tier.value,
      Number(calculator.elements.quantity.value),
    );
    result.textContent = `${estimate.outputs} ${estimate.to} image${estimate.outputs === 1 ? "" : "s"}; ${estimate.remaining} ${estimate.from} remaining. Preview only: same-artwork, eligible ownership and available output inventory are required. Nothing was consumed.`;
  } catch (error) {
    result.textContent = error.message;
  }
});
const previewSelect = document.querySelector("#finish-preview-select");
previewSelect?.addEventListener("change", (event) => {
  document.querySelector(".finish-preview").dataset.previewFinish = event.target.value;
});
if (document.querySelector("#roll-purchase")) import("./roll-purchase.js?v=20261022-loop");
const cart = document.querySelector("#planned-cart");
async function renderCart() {
  if (!cart) return;
  const status = document.querySelector("#cart-status");
  let selections;
  try {
    selections = readSelections(localStorage);
  } catch {
    selections = [];
  }
  if (!selections.length) {
    cart.innerHTML =
      '<p>Your planned selection list is empty.</p><a class="button" href="/all-artwork.html">Explore gallery →</a>';
    status.textContent = "No items saved on this browser.";
    return;
  }
  try {
    const rows = await readPublishedArtworks(SUPABASE_URL, SUPABASE_ANON_KEY, {
      signal: AbortSignal.timeout(15000),
    });
    let total = 0;
    cart.innerHTML = selections
      .map((selection, index) => {
        const row = rows.find((r) => String(r.id) === selection.artworkId && r.category !== "NFT"),
          p = PLANNED_OFFERS[selection.offer];
        if (row) total += p.price + p.shipping;
        return `<article class="cart-row"><div><h2>${row ? escapeHtml(row.title) : "Artwork no longer available"}</h2><p>${escapeHtml(p.name)} · ${escapeHtml(offerSummary(selection.offer))}</p>${row ? `<a class="text-link" href="${artUrl(row.id, selection.offer)}">Review artwork and offer →</a>` : "<p>Remove this unavailable selection.</p>"}</div><button class="button secondary" type="button" data-remove-selection="${selection.artworkId}:${selection.offer}">Remove</button></article>`;
      })
      .join("");
    status.textContent = `Planned selections: ${money(total)} before applicable tax. Preview prices only; checkout is not open. No payment or inventory reservation has been made.`;
  } catch {
    cart.innerHTML = "<p>Artwork availability could not be verified. Please try again.</p>";
    status.textContent = "Your selections are saved; no payment was made.";
  }
}
cart?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-selection]");
  if (!button) return;
  try {
    const rows = readSelections(localStorage);
    const index = rows.findIndex(
      (row) => `${row.artworkId}:${row.offer}` === button.dataset.removeSelection,
    );
    if (index < 0) return;
    button.disabled = true;
    rows.splice(index, 1);
    writeSelections(localStorage, rows);
    button.closest(".cart-row")?.remove();
    updateCartCount();
    renderCart();
  } catch {
    document.querySelector("#cart-status").textContent = "Your browser could not update the cart.";
  }
});
renderCart();
