import { createPrintPreflight } from "./print-preflight-ui.js?v=20261024-one-upload";
import { supabase, invoke } from "./supabase-client.js";
import { escapeHtml } from "./catalog-core.js?v=20261022-loop";
const form = document.querySelector("#gelato-product-form");
const status = document.querySelector("#gelato-admin-status");
const list = document.querySelector("#gelato-admin-list");
const orders = document.querySelector("#gelato-admin-orders");
const picker = document.querySelector("#gelato-artwork-picker");
const sourceStatus = document.querySelector("#gelato-source-status");
const suggestions = {
  Standard: [16, 16, "Slim canvas, unframed"],
  Silver: [16, 16, "Slim canvas, unframed"],
  Gold: [16, 16, "Thick canvas, unframed"],
  Emerald: [16, 20, "Black wood floater frame, portrait"],
  Sapphire: [16, 20, "Dark wood floater frame, portrait"],
  Prismatic: [16, 20, "Natural wood floater frame, portrait"],
};
let currentId = crypto.randomUUID(),
  currentPath = "",
  products = [],
  artworks = [],
  sourceRevision = 0,
  linkedSource = false;
async function call(body) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw Error("Sign in as the studio owner.");
  return invoke("print-api", body, data.session.access_token);
}
const preflight = createPrintPreflight(
  form,
  async () => (await call({ action: "admin_inspect", productId: currentId })).facts,
);
function showTierHint() {
  const selected = suggestions[form.elements.edition_tier.value];
  document.querySelector("#gelato-tier-hint").textContent = selected
    ? `${selected[0]} × ${selected[1]} in · ${selected[2]}. Confirm the matching Gelato UID and template. Roll pricing is set centrally.`
    : "Select the tier and its canvas or frame. Roll pricing is set centrally.";
}
function reset() {
  sourceRevision++;
  form.reset();
  preflight.reset();
  currentId = crypto.randomUUID();
  currentPath = "";
  linkedSource = false;
  picker.value = "";
  showTierHint();
  sourceStatus.textContent = "Choose artwork and tier to load the same uploaded image.";
  status.textContent = "Choose artwork, tier and Gelato product. Then check and publish.";
}
async function loadSource() {
  const revision = ++sourceRevision;
  currentPath = "";
  linkedSource = false;
  preflight.reset();
  const artworkId = Number(form.elements.edition_artwork_id.value);
  const tier = form.elements.edition_tier.value;
  if (!artworkId || !tier) {
    sourceStatus.textContent = "Select both artwork and tier first.";
    return;
  }
  sourceStatus.textContent = "Loading the saved tier image…";
  try {
    const source = await call({ action: "admin_source", productId: currentId, artworkId, tier });
    if (revision !== sourceRevision) return;
    currentPath = source.path;
    linkedSource = true;
    preflight.useStoredSource(source.facts, source.previewUrl);
    sourceStatus.textContent = `Artwork #${artworkId} · ${tier} · ${source.facts.width} × ${source.facts.height} px. Same file and SHA-256 as the uploaded tier image.`;
  } catch (error) {
    if (revision === sourceRevision)
      sourceStatus.textContent = "Cannot load image: " + error.message;
  }
}
picker.onchange = () => {
  const artwork = artworks.find((item) => String(item.id) === picker.value);
  form.elements.edition_artwork_id.value = artwork?.id || "";
  if (artwork) {
    form.elements.title.value = artwork.title;
    form.elements.preview_url.value = artwork.preview_url || "";
  }
  loadSource();
};
form.elements.edition_artwork_id.addEventListener("change", () => {
  picker.value = form.elements.edition_artwork_id.value;
  loadSource();
});
form.elements.edition_tier.addEventListener("change", () => {
  const selected = suggestions[form.elements.edition_tier.value];
  if (selected) {
    const [width, height, finish] = selected;
    form.elements.kind.value = "canvas";
    form.elements.width.value = width;
    form.elements.height.value = height;
    form.elements.variant_label.value = `${width} × ${height} in · ${finish}`;
  }
  form.elements.product_uid.value = "";
  form.elements.templateUrl.value = "";
  showTierHint();
  loadSource();
});
document.querySelector("#gelato-use-tier-source").onclick = loadSource;
document.querySelector("#gelato-new").onclick = reset;
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
document.querySelector("#gelato-safe-check").addEventListener("click", () => {
  const settings = form.querySelector(".print-preflight details");
  if ([...settings.querySelectorAll("input, select")].some((input) => !input.checkValidity()))
    settings.open = true;
});
async function refresh() {
  const data = await call({ action: "admin_list" });
  products = data.products || [];
  const result = await supabase
    .from("artworks")
    .select("id,title,preview_url")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (!result.error) {
    artworks = result.data || [];
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
  document.querySelector("#gelato-artwork-help").textContent = result.error
    ? "Artwork list unavailable. Enter the shared artwork ID below."
    : "Artwork and tier select the same image uploaded in Images. No second upload.";
  list.innerHTML =
    products
      .map(
        (p) =>
          `<p><strong>${escapeHtml(p.title)}</strong> · ${escapeHtml(p.variant_label)} · ${p.active ? "Published" : "Hidden"} <button type="button" data-gelato-edit="${escapeHtml(p.id)}">Edit product</button></p>`,
      )
      .join("") || "<p>No products yet.</p>";
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
  const product = products.find((p) => p.id === edit?.dataset.gelatoEdit);
  if (!product) return;
  sourceRevision++;
  form.reset();
  currentId = product.id;
  currentPath = product.print_path;
  linkedSource = false;
  for (const key of [
    "title",
    "kind",
    "variant_label",
    "product_uid",
    "preview_url",
    "stripe_tax_code",
    "edition_artwork_id",
    "edition_tier",
  ])
    form.elements[key].value = product[key] ?? "";
  picker.value = product.edition_artwork_id || "";
  preflight.reset(product.print_specs);
  showTierHint();
  sourceStatus.textContent =
    "Existing private print file retained. Load uploaded tier image to use the current matching tier source.";
  status.textContent =
    "Editing product. Existing paid orders keep their saved file and product details.";
};
orders.onclick = async (event) => {
  const button = event.target.closest("[data-gelato-order]");
  if (!button) return;
  button.disabled = true;
  try {
    await call({ action: "admin_reconcile", orderId: button.dataset.gelatoOrder });
    await refresh();
    status.textContent = "Order checked by its existing reference. No duplicate order placed.";
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
};
form.onsubmit = async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) {
    status.textContent = "Cannot publish: complete the required product and template fields.";
    return;
  }
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    if (!currentPath) throw Error("Load the uploaded tier image first.");
    if (
      Boolean(form.elements.edition_artwork_id.value) !== Boolean(form.elements.edition_tier.value)
    )
      throw Error("Select both artwork and tier.");
    await preflight.check();
    const check = preflight.submission(true);
    const warningText = document.querySelector("#gelato-preflight-result").innerText;
    if (
      !window.confirm(
        `Publish ${form.elements.title.value} — ${form.elements.edition_tier.value}?\n\n${warningText}\n\nTechnical checks do not certify visual quality or Gelato production approval. Confirm to publish, or Cancel to keep editing. Checkout still follows server launch settings.`,
      )
    ) {
      status.textContent =
        "Publishing cancelled. Nothing was published; your setup is still available to edit.";
      return;
    }
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
        use_tier_source: linkedSource,
        active: true,
        publish_confirmed: true,
      },
    });
    await refresh();
    status.textContent =
      "Product published. Roll prices and checkout launch settings remain centrally configured.";
  } catch (error) {
    status.textContent = "Cannot publish: " + error.message;
  } finally {
    button.disabled = false;
  }
};
