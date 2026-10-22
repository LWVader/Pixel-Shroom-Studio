import { createPrintPreflight } from "./print-preflight-ui.js?v=20261022-loop";
import { supabase, invoke } from "./supabase-client.js";
import { escapeHtml } from "./catalog-core.js?v=20261022-loop";
const form = document.querySelector("#gelato-product-form"),
  status = document.querySelector("#gelato-admin-status"),
  list = document.querySelector("#gelato-admin-list"),
  orders = document.querySelector("#gelato-admin-orders");
let currentId = crypto.randomUUID(),
  currentPath = "",
  products = [];
const preflight = createPrintPreflight(
  form,
  async () => (await call({ action: "admin_inspect", productId: currentId })).facts,
);
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
  status.textContent =
    "New physical product variation. Map each size/color to its exact Gelato product UID.";
}
document.querySelector("#gelato-new").onclick = reset;
async function refresh() {
  const data = await call({ action: "admin_list" });
  products = data.products || [];
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
