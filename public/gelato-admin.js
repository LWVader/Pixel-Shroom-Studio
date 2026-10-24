import { createPrintPositioner } from "./print-positioner.js?v=20261024-editor";
import { inspectPrintBytes, normalizeSpecs } from "./print-preflight-core.js?v=20261024-editor";
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
const preflight = createPrintPreflight(
  form,
  async () => (await call({ action: "admin_inspect", productId: currentId })).facts,
);
const positionStatus = document.querySelector("#gelato-position-status");
function invalidatePosition() {
  positionRevision++;
  positionSaved = false;
  savedPosition = null;
  preflight.reset();
  positionStatus.textContent = "Position changed. Save image position before publishing.";
}
const editor = createPrintPositioner(form, invalidatePosition);
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
function reuseProductProfile(includeGeometry = false) {
  const product = products.find(
    (p) =>
      p.kind === "canvas" && p.edition_tier === form.elements.edition_tier.value && p.product_uid,
  );
  if (!product) return;
  for (const key of ["product_uid", "stripe_tax_code"])
    if (!form.elements[key].value) form.elements[key].value = product[key] || "";
  if (includeGeometry && product.print_specs)
    for (const key of ["bleedMm", "wrapMm", "safeMm", "minimumDpi", "templateUrl"])
      if (product.print_specs[key] != null) form.elements[key].value = product.print_specs[key];
}
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
  source = null;
  positionSaved = false;
  savedPosition = null;
  editor.clear();
  form.elements.width.value = 16;
  form.elements.height.value = 16;
  picker.value = "";
  showTierHint();
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
  const selected = suggestions[form.elements.edition_tier.value];
  if (selected) {
    const [width, height, finish] = selected;
    form.elements.kind.value = "canvas";
    form.elements.width.value = width;
    form.elements.height.value = height;
    form.elements.variant_label.value = `${width} × ${height} in · ${finish}`;
  }
  form.elements.product_uid.value = "";
  if (!form.elements.templateUrl.value)
    form.elements.templateUrl.value = "https://dashboard.gelato.com/catalogue/categories";
  reuseProductProfile(true);
  showTierHint();
  const framed = ["Emerald", "Sapphire", "Prismatic"].includes(form.elements.edition_tier.value);
  document.querySelector("#gelato-size-preset").value = framed ? "canvasPortrait" : "canvasSquare";
  for (const option of document.querySelector("#gelato-size-preset").options)
    option.disabled = framed ? option.value !== "canvasPortrait" : option.value !== "canvasSquare";
  editor.redraw();
  if (source && !source.fromTier) invalidatePosition();
  else loadSource();
});
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
document.querySelector("#gelato-size-preset").addEventListener("change", () => {
  editor.redraw();
  invalidatePosition();
});
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
    const settings = normalizeSpecs(
      Object.fromEntries(
        [
          "width",
          "height",
          "bleedMm",
          "wrapMm",
          "safeMm",
          "minimumDpi",
          "templateUrl",
          "transparent",
        ].map((key) => [
          key,
          form.elements[key].type === "checkbox"
            ? form.elements[key].checked
            : form.elements[key].value,
        ]),
      ),
    );
    if (![16].includes(settings.width) || ![16, 20].includes(settings.height))
      throw Error("Choose a promised canvas size: 16 × 16 or 16 × 20 portrait.");
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
    preflight.useStoredSource(facts, previewUpload.publicUrl);
    positionSaved = true;
    await preflight.check();
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
list.onclick = async (event) => {
  const edit = event.target.closest("[data-gelato-edit]");
  const product = products.find((p) => p.id === edit?.dataset.gelatoEdit);
  if (!product) return;
  sourceRevision++;
  form.reset();
  currentId = product.id;
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
  ])
    form.elements[key].value = product[key] ?? "";
  picker.value = product.edition_artwork_id || "";
  preflight.reset(product.print_specs);
  showTierHint();
  try {
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
