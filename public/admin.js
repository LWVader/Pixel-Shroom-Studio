// SECTION: Dashboard state and shared helpers
import { mapArtwork, supabase } from "./supabase-client.js";
const loginPanel = document.querySelector("#login-panel");
const dashboard = document.querySelector("#dashboard");
const loginForm = document.querySelector("#login-form");
const artForm = document.querySelector("#art-form");
const adminCatalog = document.querySelector("#admin-catalog");
const cancelEdit = document.querySelector("#cancel-edit");
let items = [];
let editingArtworkId = null;

const clean = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
})[character]);

function showMessage(selector, message, success = false) {
  const element = document.querySelector(selector);
  element.textContent = message;
  element.classList.toggle("success", success);
}

function objectName(prefix, fileName) {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
  return `${prefix}/${crypto.randomUUID()}-${safeName}`;
}

// SECTION: Sole-administrator authorization
async function requireAdmin() {
  const session = supabase.auth.user();
  if (!session?.user?.id) throw new Error("Sign in required.");
  const rows = await sb.table("admin_users", `?select=user_id&user_id=eq.${encodeURIComponent(session.user.id)}&limit=1`);
  if (!rows.length) throw new Error("This account is not an administrator.");
  return session.user;
}

// SECTION: Image reading and permanent watermark generation
function readImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("The selected original is not a readable image.")); };
    image.src = url;
  });
}

function toBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("Could not generate the protected preview.")),
    "image/webp",
    0.82
  ));
}

function coverWithWatermark(context, width, height, serialNumber) {
  const tileSize = Math.max(160, Math.round(Math.min(width, height) * 0.24));
  const tile = document.createElement("canvas");
  tile.width = tileSize;
  tile.height = tileSize;
  const tileContext = tile.getContext("2d");

  tileContext.translate(tileSize / 2, tileSize / 2);
  tileContext.rotate(-Math.PI / 4);
  tileContext.textAlign = "center";
  tileContext.textBaseline = "middle";
  tileContext.font = `700 ${Math.max(14, Math.round(tileSize * 0.09))}px Arial, sans-serif`;
  tileContext.lineWidth = Math.max(2, tileSize * 0.012);
  tileContext.strokeStyle = "rgba(0,0,0,.74)";
  tileContext.fillStyle = "rgba(255,255,255,.74)";

  ["PIXEL SHROOM STUDIO", "PROTECTED PREVIEW", serialNumber].forEach((line, index) => {
    const y = (index - 1) * tileSize * 0.13;
    tileContext.strokeText(line, 0, y);
    tileContext.fillText(line, 0, y);
  });

  const pattern = context.createPattern(tile, "repeat");
  if (!pattern) throw new Error("This browser cannot create the watermark pattern.");
  context.fillStyle = pattern;
  context.fillRect(0, 0, width, height);
}

async function generatePreview(originalFile, serialNumber) {
  if (!originalFile.type.startsWith("image/")) {
    throw new Error("Select a PNG, JPEG, or WebP serialized original.");
  }
  const image = await readImage(originalFile);
  const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  context.drawImage(image, 0, 0, width, height);
  coverWithWatermark(context, width, height, serialNumber);
  return { blob: await toBlob(canvas), width: image.naturalWidth, height: image.naturalHeight };
}

// SECTION: Private original and public derivative uploads
async function uploadFiles(formData, current) {
  const originalFile = formData.get("originalFile");
  if (!(originalFile instanceof File) || !originalFile.size) {
    if (!current?.preview_url || !current?.original_path) throw new Error("Select the serialized original image.");
    return {
      previewPath: current.preview_path || "",
      previewUrl: current.preview_url,
      originalPath: current.original_path,
      width: current.display_width,
      height: current.display_height
    };
  }

  const serial = formData.get("serialNumber").trim().toUpperCase();
  const preview = await generatePreview(originalFile, serial);
  const previewFile = new File([preview.blob], "protected-preview.webp", { type: "image/webp" });
  const previewPath = objectName("artworks", previewFile.name);
  const originalPath = objectName("artworks", originalFile.name);

  await sb.upload("previews", previewPath, previewFile);
  await sb.upload("originals", originalPath, originalFile);

  return {
    previewPath,
    previewUrl: sb.publicUrl("previews", previewPath),
    originalPath,
    width: preview.width,
    height: preview.height
  };
}

// SECTION: Catalog and dashboard data
async function loadItems() {
  items = await sb.table("artworks", "?select=*&order=created_at.desc");
  adminCatalog.innerHTML = items.length ? items.map((item) => `
    <article class="admin-item">
      <img class="admin-thumb" src="${clean(item.preview_url)}" alt="${clean(item.title)} protected preview">
      <div>
        <strong>${clean(item.title)}</strong>
        <small>${clean(item.artist)} · ${clean(item.category)} · $${Number(item.price).toFixed(2)}</small>
        <small>${clean(item.serial_number)} · ${item.display_width} × ${item.display_height}px · ${clean(item.status)}</small>
        <small>Private original: ${item.original_path ? "stored securely" : "not stored"}</small>
      </div>
      <div class="item-actions">
        <button data-edit="${item.id}">Edit</button>
        <button data-toggle="${item.id}">${item.status === "published" ? "Archive" : "Publish"}</button>
      </div>
    </article>`).join("") : "<p>No listings yet.</p>";
}

async function loadDashboard() {
  const [articles, orders] = await Promise.all([
    sb.table("articles", "?select=*&order=created_at.desc"),
    sb.table("orders", "?select=*,artworks(title,category,serial_number)&order=created_at.desc&limit=100")
  ]);
  document.querySelector("#stats").innerHTML = `
    <div><strong>${items.length}</strong><span>Listings</span></div>
    <div><strong>${orders.length}</strong><span>Orders</span></div>
    <div><strong>${orders.filter((order) => order.status === "paid").length}</strong><span>Paid</span></div>`;
  document.querySelector("#admin-articles").innerHTML = articles.map((article) => `
    <div class="article-admin-row"><strong>${clean(article.title)}</strong>
    <button data-article="${article.id}" data-next="${article.status === "published" ? "draft" : "published"}">${article.status === "published" ? "Unpublish" : "Publish"}</button></div>`
  ).join("") || "<p>No articles yet.</p>";
  document.querySelector("#admin-orders").innerHTML = orders.map((order) => `
    <div class="order-row"><strong>${clean(order.artworks?.title || "Artwork")}</strong>
    <span>${clean(order.provider)} · ${clean(order.status)} · $${Number(order.amount).toFixed(2)}</span></div>`
  ).join("") || "<p>No orders yet.</p>";
}

async function showDashboard() {
  await requireAdmin();
  loginPanel.hidden = true;
  dashboard.hidden = false;
  await loadItems();
  await loadDashboard();
}

// SECTION: Artwork form state and automatic dimensions
function resetArtworkForm() {
  editingArtworkId = null;
  artForm.reset();
  artForm.elements.displayWidth.value = 600;
  artForm.elements.displayHeight.value = 600;
  cancelEdit.hidden = true;
  document.querySelector("#art-form-title").textContent = "Add artwork or NFT";
  document.querySelector("#save-button").textContent = "Publish new listing";
  document.querySelector("#original-status").textContent = "No original selected.";
}

artForm.elements.originalFile.addEventListener("change", async () => {
  const file = artForm.elements.originalFile.files[0];
  const status = document.querySelector("#original-status");
  if (!file) { status.textContent = "No original selected."; return; }
  try {
    const image = await readImage(file);
    artForm.elements.displayWidth.value = image.naturalWidth;
    artForm.elements.displayHeight.value = image.naturalHeight;
    status.textContent = `Selected: ${file.name} · ${image.naturalWidth} × ${image.naturalHeight}px`;
  } catch (error) { status.textContent = error.message; }
});

// SECTION: Authentication
loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("#login-message", "Signing in…", true);
  const values = new FormData(loginForm);
  try {
    await sb.signIn(values.get("email"), values.get("password"));
    await showDashboard();
  } catch (error) {
    sb.signOut();
    showMessage("#login-message", error.message);
  }
});

// SECTION: Artwork creation and editing
artForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.querySelector("#save-button");
  button.disabled = true;
  showMessage("#form-message", "Generating protected preview and saving…", true);
  try {
    await requireAdmin();
    const values = new FormData(artForm);
    const current = items.find((item) => item.id === editingArtworkId);
    const files = await uploadFiles(values, current);
    const row = {
      title: values.get("title").trim(), artist: values.get("artist").trim(),
      serial_number: values.get("serialNumber").trim().toUpperCase(), category: values.get("category"),
      price: Number(values.get("price")), display_width: files.width, display_height: files.height,
      status: values.get("status"), preview_path: files.previewPath, preview_url: files.previewUrl,
      original_path: files.originalPath, updated_at: new Date().toISOString()
    };
    const wasEditing = Boolean(editingArtworkId);
    await sb.mutate("artworks", wasEditing ? "PATCH" : "POST", wasEditing ? `?id=eq.${editingArtworkId}` : "", row);
    resetArtworkForm();
    showMessage("#form-message", wasEditing ? "Listing updated." : "Listing created.", true);
    await loadItems();
    await loadDashboard();
  } catch (error) { showMessage("#form-message", error.message); }
  finally { button.disabled = false; }
});

adminCatalog.addEventListener("click", async (event) => {
  const edit = event.target.closest("[data-edit]");
  const toggle = event.target.closest("[data-toggle]");
  if (edit) {
    const item = items.find((entry) => entry.id === Number(edit.dataset.edit));
    editingArtworkId = item.id;
    const values = { title: item.title, artist: item.artist, category: item.category, serialNumber: item.serial_number, price: item.price, displayWidth: item.display_width, displayHeight: item.display_height, status: item.status };
    Object.entries(values).forEach(([name, value]) => { artForm.elements.namedItem(name).value = value; });
    document.querySelector("#art-form-title").textContent = `Editing: ${item.title}`;
    document.querySelector("#save-button").textContent = "Save listing changes";
    cancelEdit.hidden = false;
    artForm.scrollIntoView({ behavior: "smooth" });
  }
  if (toggle) {
    const item = items.find((entry) => entry.id === Number(toggle.dataset.toggle));
    await sb.mutate("artworks", "PATCH", `?id=eq.${item.id}`, { status: item.status === "published" ? "archived" : "published" });
    await loadItems(); await loadDashboard();
  }
});

cancelEdit.addEventListener("click", resetArtworkForm);
document.querySelector("#new-listing-button").addEventListener("click", () => { resetArtworkForm(); artForm.scrollIntoView({ behavior: "smooth" }); });

// SECTION: Editorial controls
document.querySelector("#article-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  await sb.mutate("articles", "POST", "", { ...values, status: "published" });
  event.currentTarget.reset(); await loadDashboard();
});
document.querySelector("#admin-articles").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-article]");
  if (!button) return;
  await sb.mutate("articles", "PATCH", `?id=eq.${button.dataset.article}`, { status: button.dataset.next });
  await loadDashboard();
});

// SECTION: Session and password controls
document.querySelector("#logout-button").addEventListener("click", () => { sb.signOut(); location.reload(); });
const dialog = document.querySelector("#password-dialog");
document.querySelector("#change-password-button").addEventListener("click", () => dialog.showModal());
document.querySelector("#close-password").addEventListener("click", () => dialog.close());
document.querySelector("#password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try { await sb.updatePassword(new FormData(event.currentTarget).get("newPassword")); sb.signOut(); location.reload(); }
  catch (error) { showMessage("#password-message", error.message); }
});

// SECTION: Restore an existing authenticated session
showDashboard().catch(() => { sb.signOut(); loginPanel.hidden = false; dashboard.hidden = true; });
