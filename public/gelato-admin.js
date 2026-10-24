import { createPrintPreflight } from "./print-preflight-ui.js?v=20261022-loop";
import { supabase, invoke } from "./supabase-client.js";
import { escapeHtml } from "./catalog-core.js?v=20261022-loop";
const form = document.querySelector("#gelato-product-form"),
  status = document.querySelector("#gelato-admin-status"),
  list = document.querySelector("#gelato-admin-list"),
  orders = document.querySelector("#gelato-admin-orders");
let currentId = crypto.randomUUID(),
  currentPath = "",
  products = [],
  artworks = [];
const picker = document.querySelector("#gelato-artwork-picker");
const tierHint = document.querySelector("#gelato-tier-hint");
const tierSuggestions = {
  Standard: [16, 16, "Slim canvas, unframed", 49],
  Silver: [16, 16, "Slim canvas, unframed", 49],
  Gold: [16, 16, "Thick canvas, unframed", 55],
  Emerald: [16, 20, "Black wood floater frame, portrait", 79],
  Sapphire: [16, 20, "Dark wood floater frame, portrait", 79],
  Prismatic: [16, 20, "Natural wood floater frame, portrait", null],
};
function showTierHint() {
  const suggestion = tierSuggestions[form.elements.edition_tier.value];
  tierHint.textContent = suggestion
    ? `${suggestion[0]} × ${suggestion[1]} in · ${suggestion[2]}. Confirm the exact UID, bleed and wrap in Gelato.${suggestion[3] === null ? " Set a paid print price; no free claim is configured." : " Suggested later-print price: $" + suggestion[3] + "."}`
    : "Standalone product: enter its size, finish and price.";
}
picker.onchange = () => {
  const artwork = artworks.find((item) => String(item.id) === picker.value);
  form.elements.edition_artwork_id.value = artwork?.id || "";
  if (artwork) {
    form.elements.title.value = artwork.title;
    form.elements.preview_url.value = artwork.preview_url || "";
  }
  form.elements.width.dispatchEvent(new Event("input", { bubbles: true }));
};
form.elements.edition_tier.addEventListener("change", () => {
  const suggestion = tierSuggestions[form.elements.edition_tier.value];
  if (suggestion) {
    const [width, height, finish, price] = suggestion;
    form.elements.kind.value = "canvas";
    form.elements.width.value = width;
    form.elements.height.value = height;
    form.elements.variant_label.value = `${width} × ${height} in · ${finish}`;
    form.elements.price.value = price ?? "";
    // A changed tier must never retain approval or the previous product's UID.
    form.elements.product_uid.value = "";
    form.elements.templateUrl.value = "";
  }
  form.elements.width.dispatchEvent(new Event("input", { bubbles: true }));
  showTierHint();
});
form.elements.edition_artwork_id.addEventListener("input", () => {
  picker.value = form.elements.edition_artwork_id.value;
  form.elements.width.dispatchEvent(new Event("input", { bubbles: true }));
});
// Reveal any required field inside a collapsed technical section on validation.
form.addEventListener(
  "invalid",
  (event) => {
    let parent = event.target.parentElement;
    while (parent && parent !== form) {
      if (parent.tagName === "DETAILS") parent.open = true;
      parent = parent.parentElement;
    }
  },
  true,
);
const preflight = createPrintPreflight(
  form,
  async () => (await call({ action: "admin_inspect", productId: currentId })).facts,
);
document.querySelector("#gelato-safe-check").addEventListener("click", () => {
  const settings = form.querySelector(".print-preflight details");
  if ([...settings.querySelectorAll("input, select")].some((input) => !input.checkValidity())) {
    settings.open = true;
  }
});
async function call(body) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw Error("Sign in as the studio owner.");
  return invoke("print-api", body, data.session.access_token);
}
function reset() {
  form.reset();
  preflight.reset();
  currentId = crypto.randomUUID();
  currentPath = "";
  status.textContent = "New product: choose artwork and tier, then connect its Gelato product.";
  picker.value = "";
  showTierHint();
}
document.querySelector("#gelato-new").onclick = reset;
async function refresh() {
  const data = await call({ action: "admin_list" });
  products = data.products || [];
  const artworkResult = await supabase
    .from("artworks")
    .select("id,title,preview_url")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (!artworkResult.error) {
    artworks = artworkResult.data || [];
    picker.innerHTML =
      '<option value="">Choose a studio artwork…</option>' +
      artworks
        .map(
          (artwork) =>
            `<option value="${escapeHtml(String(artwork.id))}">${escapeHtml(artwork.title)} · #${escapeHtml(String(artwork.id))}</option>`,
        )
        .join("");
    picker.value = form.elements.edition_artwork_id.value;
  }
  document.querySelector("#gelato-artwork-help").textContent = artworkResult.error
    ? "Artwork list unavailable. You can enter its ID below; saved products and orders remain accessible."
    : "Select artwork to fill its title and protected preview. Select a tier for size and price suggestions.";
  list.innerHTML =
    products
      .map(
        (p) =>
          `<p><strong>${escapeHtml(p.title)}</strong> · ${escapeHtml(p.variant_label)} · ${p.active ? "Published" : "Hidden"} <button type="button" data-gelato-edit="${escapeHtml(p.id)}">Edit mapping</button></p>`,
      )
      .join("") || "<p>No Gelato product mappings yet.</p>";
  orders.innerHTML =
    (data.orders || [])
      .map(
        (o) =>
          `<p>${escapeHtml(o.title)} · ${escapeHtml(o.id)} · ${escapeHtml(o.paymentState)} · ${escapeHtml(o.state)} · ${escapeHtml(o.status)} <button type="button" data-gelato-order="${escapeHtml(o.id)}">Refresh / reconcile</button></p>`,
      )
      .join("") || "<p>No physical orders yet.</p>";
}
document.querySelector("#gelato-refresh").onclick = () =>
  refresh().catch((error) => (status.textContent = error.message));
list.onclick = (event) => {
  const edit = event.target.closest("[data-gelato-edit]");
  if (!edit) return;
  const p = products.find((p) => p.id === edit.dataset.gelatoEdit);
  if (!p) return;
  currentId = p.id;
  currentPath = p.print_path;
  form.reset();
  for (const key of [
    "title",
    "kind",
    "variant_label",
    "product_uid",
    "preview_url",
    "stripe_tax_code",
  ])
    form.elements[key].value = p[key];
  form.elements.edition_artwork_id.value = p.edition_artwork_id || "";
  form.elements.edition_tier.value = p.edition_tier || "";
  picker.value = p.edition_artwork_id || "";
  showTierHint();
  form.elements.price.value = (p.retail_cents / 100).toFixed(2);
  form.elements.active.checked = p.active;
  form.elements.print_ready.checked = p.print_ready;
  preflight.reset(p.print_specs);
  status.textContent =
    "Editing mapping. Upload a new source to revise artwork; existing paid snapshots retain the previous file.";
};
orders.onclick = async (event) => {
  const button = event.target.closest("[data-gelato-order]");
  if (!button) return;
  button.disabled = true;
  try {
    await call({ action: "admin_reconcile", orderId: button.dataset.gelatoOrder });
    await refresh();
    status.textContent =
      "Order checked. An ambiguous submission is reconciled by reference, never blindly resubmitted.";
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
};
form.onsubmit = async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    if (
      Boolean(form.elements.edition_artwork_id.value) !== Boolean(form.elements.edition_tier.value)
    ) {
      throw Error(
        "Choose both an artwork and print tier for a Vault mapping, or leave both empty for a standalone product.",
      );
    }
    const check = preflight.submission(form.elements.active.checked);
    const file = form.elements.printFile.files[0];
    if (file) {
      const extension = { "image/png": "png", "image/jpeg": "jpg", "application/pdf": "pdf" }[
        file.type
      ];
      if (!extension || file.size > 104857600)
        throw Error("Use a print-ready PNG, JPEG or PDF up to 100 MB.");
      const upload = await call({ action: "admin_upload", productId: currentId, extension });
      const { error } = await supabase.storage
        .from("gelato-print-files")
        .uploadToSignedUrl(upload.path, upload.token, file, { contentType: file.type });
      if (error) throw error;
      currentPath = upload.path;
    }
    if (!currentPath) throw Error("Upload a dedicated print-ready file.");
    await call({
      action: "admin_save",
      product: {
        ...check,
        id: currentId,
        edition_artwork_id: form.elements.edition_artwork_id.value
          ? Number(form.elements.edition_artwork_id.value)
          : null,
        edition_tier: form.elements.edition_tier.value || null,
        title: form.elements.title.value,
        kind: form.elements.kind.value,
        variant_label: form.elements.variant_label.value,
        product_uid: form.elements.product_uid.value,
        stripe_tax_code: form.elements.stripe_tax_code.value,
        preview_url: form.elements.preview_url.value,
        print_path: currentPath,
        retail_cents: Math.round(Number(form.elements.price.value) * 100),
        active: form.elements.active.checked,
        print_ready: form.elements.print_ready.checked,
      },
    });
    await refresh();
    status.textContent =
      "Product mapping saved. Checkout still follows server environment and launch settings.";
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
};
