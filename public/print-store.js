import { supabase, invoke } from "./supabase-client.js";
import { escapeHtml, safePreviewUrl } from "./catalog-core.js?v=20261022-loop";
const status = document.querySelector("#print-status"),
  grid = document.querySelector("#print-products"),
  dialog = document.querySelector("#print-dialog"),
  form = document.querySelector("#print-quote-form"),
  result = document.querySelector("#print-quote-result");
const money = (cents) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const editionMint = new URLSearchParams(location.search).get("mint");
let canvasClaim = null;
let products = [],
  selected,
  quote,
  enabled = false,
  testMode = true;
async function call(body) {
  const { data } = await supabase.auth.getSession();
  return invoke("print-api", body, data.session?.access_token);
}
function resetQuote() {
  quote = null;
  result.replaceChildren();
}
form.addEventListener("input", resetQuote);
document.querySelector("#print-close").onclick = () => dialog.close();
grid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-print-product]");
  if (!button) return;
  selected = products.find((p) => p.id === button.dataset.printProduct);
  if (!selected) return;
  resetQuote();
  form.reset();
  document.querySelector("#print-selected").textContent =
    selected.title + " · " + selected.variant_label;
  document.querySelector("#print-form-status").textContent = testMode
    ? "Test mode: no physical product will be shipped."
    : "Delivery is currently available to US addresses.";
  dialog.showModal();
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selected || !form.reportValidity()) return;
  const button = form.querySelector("button[type=submit]"),
    message = document.querySelector("#print-form-status");
  button.disabled = true;
  resetQuote();
  try {
    const values = new FormData(form);
    const recipient = Object.fromEntries(
      [
        "firstName",
        "lastName",
        "addressLine1",
        "addressLine2",
        "city",
        "state",
        "postCode",
        "phone",
      ].map((key) => [key, String(values.get(key) || "").trim()]),
    );
    recipient.country = "US";
    const response = await call({
      action: "quote",
      productId: selected.id,
      quantity: editionMint ? 1 : Number(values.get("quantity")),
      ...(editionMint ? { mintId: editionMint } : {}),
      recipient,
      consent: values.get("consent") === "on",
    });
    quote = response;
    result.innerHTML = `<label>Delivery option<select id="print-shipping">${response.shipping.map((s) => `<option value="${escapeHtml(s.uid)}">${escapeHtml(s.name)} · ${money(s.cents)}${s.minDays && s.maxDays ? ` · estimated ${s.minDays}–${s.maxDays} days` : ""}</option>`).join("")}</select></label><p id="print-total"></p><p>Taxes, if applicable, are calculated at Stripe checkout. Confirm your delivery address before continuing. This prints the selected design. Your existing digital edition remains in My Vault.</p><button type="button" id="print-pay" class="button">${response.prepaid ? "Redeem included canvas" : response.testMode ? "Continue to test checkout" : "Continue to secure checkout"} ↗</button>`;
    const shipping = result.querySelector("select"),
      total = result.querySelector("#print-total");
    const update = () => {
      const option = quote.shipping.find((s) => s.uid === shipping.value);
      total.textContent = `Products ${money(quote.productCents)} + delivery ${money(option.cents)} = ${money(quote.productCents + option.cents)} before tax. Quote valid for 15 minutes.`;
    };
    shipping.onchange = update;
    update();
    result.querySelector("#print-pay").onclick = async (event) => {
      const pay = event.currentTarget;
      pay.disabled = true;
      try {
        const response = await call({
          action: "checkout",
          quoteId: quote.quoteId,
          shippingMethod: shipping.value,
        });
        if (response.redeemed && response.orderUrl) {
          const orderUrl = new URL(response.orderUrl);
          if (orderUrl.origin !== location.origin) throw Error("Invalid order destination.");
          location.assign(orderUrl.href);
          return;
        }
        const url = new URL(response.checkoutUrl);
        if (url.origin !== "https://checkout.stripe.com") throw Error("Invalid checkout URL.");
        location.assign(url.href);
      } catch (error) {
        message.textContent = error.message;
        pay.disabled = false;
      }
    };
    message.textContent = response.testMode
      ? "Test quote ready. No real fulfillment will occur."
      : "Review your delivery option and total below.";
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
try {
  const response = await call({
    action: "catalog",
    ...(editionMint ? { mintId: editionMint } : {}),
  });
  canvasClaim = response.canvasClaim;
  if (editionMint) {
    document.querySelector("h1").textContent = "Print your chosen edition";
    document.querySelector("main > section p")?.setAttribute("hidden", "");
  }
  if (editionMint) {
    form.elements.quantity.value = "1";
    form.elements.quantity.closest("label").hidden = true;
  }
  products = (response.products || []).filter(
    (p) => p.kind === document.body.dataset.printCategory,
  );
  enabled = response.enabled;
  testMode = response.testMode;
  status.textContent =
    canvasClaim === "available"
      ? "Your included canvas and US shipping are already paid. Review the address and redeem once."
      : products.length
        ? testMode
          ? "Test shop: physical products are not being shipped."
          : enabled
            ? "Choose your product variation, then request delivery options."
            : "Products are being prepared. Checkout is not open yet."
        : "New printed products are being prepared. Request your favorite artwork through the contact form.";
  grid.innerHTML = products
    .map(
      (p) =>
        `<article class="print-product"><img src="${escapeHtml(safePreviewUrl(p.preview_url))}" width="600" height="600" loading="lazy" alt="${escapeHtml(p.title)} product preview"><div><h3>${escapeHtml(p.title)}</h3><p>${escapeHtml(p.variant_label)}</p><p>${canvasClaim === "available" ? "Included canvas claim · no second product or shipping charge" : money(p.retail_cents) + " + $13.49 US delivery and applicable tax"}</p><button class="button" type="button" data-print-product="${escapeHtml(p.id)}" ${enabled ? "" : "disabled"}>Choose delivery ↗</button></div></article>`,
    )
    .join("");
  const schema = document.querySelector("#print-schema");
  schema.textContent = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: document.title,
    mainEntity: {
      "@type": "ItemList",
      itemListElement: products.map((p, i) => ({
        "@type": "ListItem",
        position: i + 1,
        item: {
          "@type": "Product",
          name: p.title + " · " + p.variant_label,
          image: safePreviewUrl(p.preview_url),
        },
      })),
    },
  });
} catch {
  status.textContent =
    "Printed products are temporarily unavailable. Please contact the studio for help.";
}
