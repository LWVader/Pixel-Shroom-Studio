import {
  TIER_FINISHES,
  PLANNED_OFFERS,
  forgeEstimate,
  offerSummary,
  readSelections,
  writeSelections,
  artUrl,
  money,
} from "./forge-print-core.js?v=20261022-layout";
import { readPublishedArtworks, validRows, escapeHtml } from "./catalog-core.js?v=20261022-layout";
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
const offerForm = document.querySelector("#offer-selector");
function updateOffer() {
  const key = offerForm.elements.offer.value;
  document.querySelector("#offer-summary").textContent = offerSummary(key);
  document.querySelector("#offer-guarantee").textContent =
    key === "five"
      ? "Five same-artwork results. If all are Standard, explicitly forging those five can produce one Silver; it is not a bonus sixth image."
      : key === "ten"
        ? "Ten images, with at least one Gold or better under a server-enforced floor. This planned guarantee changes the final bundle distribution."
        : key === "canvas"
          ? "One digital image and one included print claim, held until redemption. Shipping is prepaid once; applicable tax is additional."
          : "Digital-only delivery. No included canvas. Later printing uses the selected asset’s tier price; an eligible Prismatic has one promotional product-charge waiver, with shipping additional.";
}
if (offerForm) {
  offerForm.querySelector('button[type="submit"]').disabled = false;
  const requested = new URLSearchParams(location.search).get("offer");
  if (Object.hasOwn(PLANNED_OFFERS, requested || "")) offerForm.elements.offer.value = requested;
  updateOffer();
  offerForm.addEventListener("change", updateOffer);
  offerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const status = document.querySelector("#selection-status");
    try {
      const artworkId = document.querySelector("#catalog")?.dataset.artworkId;
      if (!artworkId) throw Error("Artwork unavailable.");
      const selected = readSelections(localStorage),
        offer = offerForm.elements.offer.value;
      if (selected.some((x) => x.artworkId === artworkId && x.offer === offer))
        throw Error("This planned selection is already in your cart.");
      if (selected.length >= 20)
        throw Error("Your selection list holds up to 20 offers. Remove one in the cart first.");
      selected.push({ artworkId, offer });
      writeSelections(localStorage, selected);
      updateCartCount();
      status.innerHTML =
        'Selection saved. No payment or inventory reservation was made. <a href="/cart.html">View cart →</a>';
    } catch (error) {
      status.textContent = error.message || "Your browser could not save this selection.";
    }
  });
  document.querySelector("#finish-preview-select").addEventListener("change", (event) => {
    document.querySelector(".finish-preview").dataset.previewFinish = event.target.value;
  });
}
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
