import {
  CANVAS_TAX_CODE,
  GELATO_PRODUCT_OPTIONS,
} from "./gelato-product-options.js?v=20261024-uids-v1";
import { canvasProduct } from "./canvas-products-core.js?v=20261024-portrait-v2";
import { createPrintPositioner } from "./print-positioner.js?v=20261024-portrait-v2";
import { inspectPrintBytes } from "./print-preflight-core.js?v=20261024-editor";
import { supabase, invoke } from "./supabase-client.js";
import { escapeHtml } from "./catalog-core.js?v=20261022-loop";
const form = document.querySelector("#gelato-product-form");
const status = document.querySelector("#gelato-admin-status");
const list = document.querySelector("#gelato-admin-list");
const orders = document.querySelector("#gelato-admin-orders");
const picker = document.querySelector("#gelato-artwork-picker");
const sourceStatus = document.querySelector("#gelato-source-status");
let currentId = crypto.randomUUID(),
  currentPath = "",
  products = [],
  artworks = [],
  sourceRevision = 0,
  linkedSource = false,
  source = null,
  positionSaved = false,
  savedPosition = null,
  saveInProgress = false,
  positionRevision = 0;
async function call(body) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw Error("Sign in as the studio owner.");
  return invoke("print-api", body, data.session.access_token);
}
let productSpecs = canvasProduct("Standard").specs,
  loadedCatalog = null,
  savedHash = "";
const positionStatus = document.querySelector("#gelato-position-status");
function invalidatePosition() {
  positionRevision++;
  positionSaved = false;
  savedPosition = null;
  positionStatus.textContent = "Position changed. Save image position before publishing.";
}
const editor = createPrintPositioner(form, invalidatePosition, () => productSpecs);
async function fingerprint(blob) {
  const buffer = await blob.arrayBuffer();
  const facts = inspectPrintBytes(buffer);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return {
    ...facts,
    sha256: [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, "0")).join(""),
  };
}
async function receiveSource(blob, facts, path, fromTier, position) {
  if (blob.size > 104857600 || !["png", "jpg"].includes(facts.format))
    throw Error("Choose a PNG or JPEG up to 100 MB.");
  const dimensions = await editor.load(blob, position);
  if (dimensions.width !== facts.width || dimensions.height !== facts.height)
    throw Error(
      "Image orientation differs from its file header. Re-export as a flattened, correctly oriented PNG/JPEG.",
    );
  source = { blob, facts, path, fromTier };
  linkedSource = fromTier;
  currentPath = "";
  positionSaved = false;
  positionStatus.textContent =
    "Drag or resize the artwork, preview the canvas, then save its position.";
}
function profile() {
  return canvasProduct(
    form.elements.edition_tier.value || "Standard",
    form.elements.frame_finish.value,
  );
}
function reuseProductProfile() {
  const previous = products.find(
    (p) =>
      p.canvas_version === 3 &&
      p.edition_tier === form.elements.edition_tier.value &&
      p.frame_finish === profile().frame,
  );
  if (!previous) return;
  if (!form.elements.product_uid.value) form.elements.product_uid.value = previous.product_uid;
  if (!form.elements.stripe_tax_code.value)
    form.elements.stripe_tax_code.value = previous.stripe_tax_code || "";
  if (previous.product_uid === form.elements.product_uid.value && previous.print_specs)
    productSpecs = { ...previous.print_specs, width: profile().width, height: profile().height };
}
const productChoice = document.querySelector("#gelato-product-choice");
function updateProductChoices(preserveUid = false) {
  const tier = form.elements.edition_tier.value || "Standard";
  const choices = GELATO_PRODUCT_OPTIONS;
  productChoice.replaceChildren(...choices.map((p) => new Option(p.label, p.uid)));
  const existing = form.elements.product_uid.value;
  if (preserveUid && existing && !choices.some((p) => p.uid === existing))
    productChoice.add(new Option("Saved product UID · custom/previous mapping", existing));
  const selected =
    preserveUid && existing
      ? existing
      : choices.find((p) => p.tiers.includes(tier) && p.frame === profile().frame)?.uid ||
        choices[0].uid;
  productChoice.value = selected;
  if (!preserveUid) form.elements.product_uid.value = selected;
  if (!form.elements.stripe_tax_code.value) form.elements.stripe_tax_code.value = CANVAS_TAX_CODE;
}
productChoice.addEventListener("change", () => {
  const choice = GELATO_PRODUCT_OPTIONS.find((p) => p.uid === productChoice.value);
  if (!choice) return;
  const previousTier = form.elements.edition_tier.value;
  if (!choice.tiers.includes(previousTier)) form.elements.edition_tier.value = choice.tiers[0];
  form.elements.frame_finish.value = choice.frame;
  applyProduct();
  if (previousTier !== form.elements.edition_tier.value) {
    if (source && !source.fromTier) invalidatePosition();
    else loadSource();
  }
});
function showTierHint() {
  const p = profile();
  document.querySelector("#gelato-tier-hint").textContent =
    p.label + " · US delivery only. Roll prices are set centrally.";
  document.querySelector("#gelato-product-size").textContent = p.label;
}
function applyProduct() {
  const tier = form.elements.edition_tier.value || "Standard";
  const framed = ["Emerald", "Sapphire", "Prismatic"].includes(tier);
  if (framed && form.elements.frame_finish.value === "none")
    form.elements.frame_finish.value = "black";
  if (!framed) form.elements.frame_finish.value = "none";
  for (const option of form.elements.frame_finish.options)
    option.disabled = framed ? option.value === "none" : option.value !== "none";
  const p = profile();
  productSpecs = p.specs;
  form.elements.variant_label.value = p.label;
  form.elements.product_uid.value = "";
  loadedCatalog = null;
  reuseProductProfile();
  updateProductChoices();
  showTierHint();
  invalidatePosition();
  editor.redraw();
  document.querySelector("#gelato-product-summary").textContent =
    "Load the selected product UID before saving its position or publishing.";
}
form.elements.product_uid.addEventListener("input", () => {
  loadedCatalog = null;
});
document.querySelector("#gelato-load-product").onclick = async () => {
  const button = document.querySelector("#gelato-load-product");
  button.disabled = true;
  const uid = form.elements.product_uid.value.trim();
  try {
    const data = await call({
      action: "admin_product",
      productUid: uid,
      tier: form.elements.edition_tier.value,
      frame: profile().frame,
    });
    if (uid !== form.elements.product_uid.value.trim()) return;
    loadedCatalog = data.product;
    const attributes = Object.entries(loadedCatalog.attributes || {})
      .filter(([key]) => /canvas|frame|format|size|thickness/i.test(key))
      .map(([key, value]) => `${key}: ${value}`)
      .slice(0, 6)
      .join(" · ");
    document.querySelector("#gelato-product-summary").textContent =
      `Loaded from Gelato · US available · ${profile().label}${attributes ? " · Catalog: " + attributes : ""}. Preview this product before publishing. No order has been sent.`;
  } catch (error) {
    loadedCatalog = null;
    document.querySelector("#gelato-product-summary").textContent = error.message;
  } finally {
    button.disabled = false;
  }
};
function reset() {
  sourceRevision++;
  form.reset();
  currentId = crypto.randomUUID();
  currentPath = "";
  linkedSource = false;
  source = null;
  positionSaved = false;
  savedPosition = null;
  editor.clear();
  productSpecs = canvasProduct("Standard").specs;
  loadedCatalog = null;
  savedHash = "";
  picker.value = "";
  applyProduct();
  sourceStatus.textContent = "Choose artwork and tier to load the same uploaded image.";
  status.textContent = "Choose artwork, tier and Gelato product. Then check and publish.";
}
async function loadSource() {
  const revision = ++sourceRevision;
  currentPath = "";
  linkedSource = false;
  source = null;
  positionSaved = false;
  savedPosition = null;
  editor.clear();
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
    const response = await fetch(source.previewUrl, { cache: "no-store" });
    if (!response.ok) throw Error("Private source preview is unavailable. Reload the tier image.");
    const blob = await response.blob();
    if (revision !== sourceRevision) return;
    await receiveSource(blob, source.facts, source.path, true);
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
  applyProduct();
  if (source && !source.fromTier) invalidatePosition();
  else loadSource();
});
form.elements.frame_finish.addEventListener("change", applyProduct);
document.querySelector("#gelato-use-tier-source").onclick = loadSource;
form.elements.printFile.addEventListener("change", async () => {
  const file = form.elements.printFile.files[0];
  if (!file) return;
  const revision = ++sourceRevision;
  source = null;
  currentPath = "";
  linkedSource = false;
  invalidatePosition();
  try {
    if (file.size > 104857600) throw Error("Choose a PNG or JPEG up to 100 MB.");
    const facts = await fingerprint(file);
    if (revision !== sourceRevision) return;
    await receiveSource(file, facts, "", false);
    sourceStatus.textContent = `${file.name} · ${facts.width} × ${facts.height} px · linked to the selected artwork for printing.`;
  } catch (error) {
    sourceStatus.textContent = "Cannot load image: " + error.message;
  }
});
const siteDialog = document.querySelector("#gelato-site-art-dialog");
document.querySelector("#gelato-browse-site").onclick = async () => {
  try {
    await refresh();
    document.querySelector("#gelato-site-art-list").innerHTML =
      artworks
        .map(
          (artwork) =>
            `<button type="button" data-site-art="${escapeHtml(String(artwork.id))}"><img src="${escapeHtml(artwork.preview_url || "")}" alt="${escapeHtml(artwork.title)} protected preview"/><span>${escapeHtml(artwork.title)}</span></button>`,
        )
        .join("") ||
      "<p>No saved artwork. Add the artwork and six tier images in Images first.</p>";
    siteDialog.showModal();
  } catch (error) {
    status.textContent = error.message;
  }
};
document.querySelector("#gelato-close-site-art").onclick = () => siteDialog.close();
document.querySelector("#gelato-site-art-list").onclick = (event) => {
  const button = event.target.closest("[data-site-art]");
  if (!button) return;
  if (!form.elements.edition_tier.value) {
    form.elements.edition_tier.value = "Standard";
    form.elements.edition_tier.dispatchEvent(new Event("change", { bubbles: true }));
  }
  picker.value = button.dataset.siteArt;
  picker.dispatchEvent(new Event("change", { bubbles: true }));
  siteDialog.close();
};
async function uploadPrivate(blob, extension, productId = currentId) {
  const upload = await call({ action: "admin_upload", productId, extension });
  const { error } = await supabase.storage
    .from("gelato-print-files")
    .uploadToSignedUrl(upload.path, upload.token, blob, {
      contentType: extension === "jpg" ? "image/jpeg" : "image/png",
    });
  if (error) throw error;
  return upload.path;
}
document.querySelector("#gelato-save-position").onclick = async () => {
  if (saveInProgress) return;
  const button = document.querySelector("#gelato-save-position");
  button.disabled = true;
  saveInProgress = true;
  const revision = sourceRevision;
  const editRevision = positionRevision;
  try {
    if (!source) throw Error("Browse site artwork or choose an image from your computer first.");
    const selectedSource = source;
    const productId = currentId;
    if (!loadedCatalog || loadedCatalog.productUid !== form.elements.product_uid.value.trim())
      throw Error("Load the Gelato product first so its product UID can be verified.");
    const rendered = await editor.render();
    if (!selectedSource.path)
      selectedSource.path = await uploadPrivate(
        selectedSource.blob,
        selectedSource.facts.format,
        productId,
      );
    const path = await uploadPrivate(rendered.blob, "png", productId);
    const previewUpload = await call({ action: "admin_preview_upload", productId });
    const { error } = await supabase.storage
      .from("previews")
      .uploadToSignedUrl(previewUpload.path, previewUpload.token, rendered.preview, {
        contentType: "image/webp",
      });
    if (error) throw error;
    const facts = await fingerprint(rendered.blob);
    if (
      revision !== sourceRevision ||
      editRevision !== positionRevision ||
      selectedSource !== source ||
      productId !== currentId
    )
      throw Error("Image selection changed. Save the current position again.");
    currentPath = path;
    savedPosition = {
      ...rendered.position,
      source_path: selectedSource.path,
      source_sha256: selectedSource.facts.sha256,
    };
    form.elements.preview_url.value = previewUpload.publicUrl;
    reuseProductProfile();
    if (!form.elements.title.value) {
      const artwork = artworks.find((a) => String(a.id) === form.elements.edition_artwork_id.value);
      form.elements.title.value =
        artwork?.title || selectedSource.blob.name?.replace(/\.[^.]+$/, "") || "Studio artwork";
    }
    savedHash = facts.sha256;
    positionSaved = true;
    positionStatus.textContent = `Position saved: ${facts.width} × ${facts.height} px. Print file, preview URL, image dimensions and hash filled automatically. Actual source detail: ${rendered.geometry.effectivePpi.toFixed(1)} PPI.`;
  } catch (error) {
    positionSaved = false;
    positionStatus.textContent = "Cannot save position: " + error.message;
  } finally {
    button.disabled = false;
    saveInProgress = false;
  }
};
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
          `<article class="gelato-loaded-product"><img src="${escapeHtml(p.preview_url || "")}" alt="${escapeHtml(p.title)} protected product preview" loading="lazy"/><h3>${escapeHtml(p.title)}</h3><p>${escapeHtml(p.variant_label)}</p><p>${p.canvas_version === 3 ? "Current canvas format" : "Previous format · retained for earlier purchases"} · ${p.active ? "Published" : "Hidden"}</p><button type="button" data-gelato-edit="${escapeHtml(p.id)}">${p.canvas_version === 3 ? "Load & preview" : "Create updated product"}</button></article>`,
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
list.onclick = async (event) => {
  const edit = event.target.closest("[data-gelato-edit]");
  const product = products.find((p) => p.id === edit?.dataset.gelatoEdit);
  if (!product) return;
  sourceRevision++;
  form.reset();
  currentId = product.canvas_version === 3 ? product.id : crypto.randomUUID();
  currentPath = product.print_path;
  linkedSource = false;
  source = null;
  positionSaved = false;
  savedPosition = null;
  editor.clear();
  for (const key of [
    "title",
    "kind",
    "variant_label",
    "product_uid",
    "preview_url",
    "stripe_tax_code",
    "edition_artwork_id",
    "edition_tier",
    "frame_finish",
  ])
    form.elements[key].value = product[key] ?? "";
  picker.value = product.edition_artwork_id || "";
  productSpecs = product.canvas_version === 3 ? product.print_specs : profile().specs;
  loadedCatalog = null;
  savedHash = "";
  updateProductChoices(true);
  showTierHint();
  try {
    if (product.canvas_version !== 3) {
      updateProductChoices();
      await loadSource();
      status.textContent =
        "Previous format preserved. Load the new product UID and save a current-format mapping.";
      return;
    }
    const data = await call({ action: "admin_inspect", productId: currentId, editorSource: true });
    const response = await fetch(data.previewUrl, { cache: "no-store" });
    if (!response.ok) throw Error("Stored image cannot be loaded.");
    await receiveSource(
      await response.blob(),
      data.facts,
      data.path,
      Boolean(product.preflight_report?.sourceArtworkId),
      data.position,
    );
    sourceStatus.textContent =
      "Saved source and positioning loaded. Save image position before republishing.";
    await document.querySelector("#gelato-load-product").onclick();
    if (loadedCatalog) document.querySelector("#gelato-open-product-preview").click();
  } catch (error) {
    sourceStatus.textContent = error.message;
  }
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
    if (!currentPath || !positionSaved)
      throw Error(
        "Save image position first. Changing the source or product settings requires saving again.",
      );
    if (
      Boolean(form.elements.edition_artwork_id.value) !== Boolean(form.elements.edition_tier.value)
    )
      throw Error("Select both artwork and tier.");
    if (!loadedCatalog || loadedCatalog.productUid !== form.elements.product_uid.value.trim())
      throw Error("Load the selected Gelato product before publishing.");
    const check = { preflight_hash: savedHash, print_specs: productSpecs };
    const warningText = `Gelato product: ${loadedCatalog.productUid} · ${profile().label}. No fulfillment order will be created by publishing.`;
    if (
      !window.confirm(
        `Publish ${form.elements.title.value} — ${form.elements.edition_tier.value}?\n\n${warningText}\n\nConfirm to save this product to the studio catalog, or Cancel to keep editing. No order is sent to Gelato by publishing.`,
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
        kind: "canvas",
        frame_finish: profile().frame,
        variant_label: form.elements.variant_label.value,
        product_uid: form.elements.product_uid.value,
        stripe_tax_code: form.elements.stripe_tax_code.value,
        preview_url: form.elements.preview_url.value,
        print_path: currentPath,
        use_tier_source: linkedSource,
        position: savedPosition,
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

applyProduct();
