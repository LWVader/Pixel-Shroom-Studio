import { supabase, invoke } from "./supabase-client.js";
import { SUPABASE_URL } from "./config.js";
import { escapeHtml, checkoutUrl } from "./catalog-core.js?v=20261022-loop";
import { marketMoney, marketPreviewUrl } from "./market-core.js";
const grid = document.querySelector("#market-feed"),
  status = document.querySelector("#market-status"),
  form = document.querySelector("#market-filters");
const next = document.querySelector("#market-next"),
  previous = document.querySelector("#market-previous");
let offset = 0,
  busy = false,
  poll;
async function call(body) {
  const { data } = await supabase.auth.getSession();
  return invoke("market-api", body, data.session?.access_token);
}
async function load() {
  if (busy) return;
  busy = true;
  try {
    const values = new FormData(form);
    const result = await call({
      action: "feed",
      search: values.get("search"),
      tier: values.get("tier"),
      offset,
    });
    if (!result.enabled) {
      grid.replaceChildren();
      status.textContent =
        "The secondary marketplace is not open yet. Your collection and existing purchases remain available.";
      return;
    }
    grid.innerHTML = result.items
      .map(
        (item) =>
          `<article class="foil-card" data-tier="${escapeHtml(item.tier)}"><img loading="lazy" src="${escapeHtml(marketPreviewUrl(item.preview_path, SUPABASE_URL))}" alt="Protected preview of ${escapeHtml(item.title)}, ${escapeHtml(item.tier)} edition"><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.tier)} · #${item.mint_number} of ${item.max_supply}</p><p>${escapeHtml(item.serial)}</p><p class="market-price">${marketMoney(item.price_cents)}</p><button class="button" data-market-buy="${escapeHtml(item.id)}">Buy this edition with Stripe ↗</button></article>`,
      )
      .join("");
    status.textContent = result.items.length
      ? "Available studio-recorded editions. Listings are reserved during checkout; availability is checked again before payment."
      : "No matching editions are currently listed.";
    next.hidden = !result.hasMore;
    previous.hidden = offset === 0;
  } catch (error) {
    status.textContent = error.message;
  } finally {
    busy = false;
  }
}
form.onsubmit = (event) => {
  event.preventDefault();
  offset = 0;
  load();
};
next.onclick = () => {
  offset += 24;
  load();
};
previous.onclick = () => {
  offset = Math.max(0, offset - 24);
  load();
};
grid.onclick = async (event) => {
  const button = event.target.closest("[data-market-buy]");
  if (!button) return;
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    location.assign("/collection.html");
    return;
  }
  button.disabled = true;
  try {
    const result = await call({ action: "checkout", listingId: button.dataset.marketBuy });
    location.assign(checkoutUrl(result.checkoutUrl, "stripe"));
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
  }
};
const purchaseId = new URLSearchParams(location.search).get("purchase");
async function checkPurchase() {
  if (!purchaseId) return;
  const panel = document.querySelector("#market-purchase");
  panel.hidden = false;
  try {
    const result = await call({ action: "purchase", purchaseId });
    const state = result.purchase.state;
    panel.textContent =
      state === "succeeded"
        ? "Payment verified. The edition is now registered to your account. Open My collection to view and download it."
        : state === "pending"
          ? "Waiting for payment confirmation and the ownership transfer. You can return to this page later."
          : state === "refund_pending"
            ? "The transfer could not complete. A refund is being processed; contact the studio with your purchase number if it does not resolve."
            : `Purchase status: ${state}. Contact the studio if you need help.`;
    if (state !== "pending" && state !== "refund_pending") clearInterval(poll);
  } catch (error) {
    panel.textContent = error.message;
  }
}
load();
if (purchaseId) {
  checkPurchase();
  poll = setInterval(checkPurchase, 3000);
  setTimeout(() => clearInterval(poll), 180000);
}
