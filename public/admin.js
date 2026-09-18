// SECTION: Administrator page DOM state
const loginPanel = document.querySelector("#login-panel"), dashboard = document.querySelector("#dashboard"), loginForm = document.querySelector("#login-form"), artForm = document.querySelector("#art-form"), adminCatalog = document.querySelector("#admin-catalog"), cancelEdit = document.querySelector("#cancel-edit");
let items = [];
// SECTION: Authenticated API request and safe-text helpers
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...options.body ? { "Content-Type": "application/json" } : {}, ...options.headers || {} } }), data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}
const clean = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
function showMessage(id, message, success = false) {
  const element = document.querySelector(id);
  element.textContent = message;
  element.classList.toggle("success", success);
}
// SECTION: Client-side Postimages hotlink extraction and feedback
function extractHotlinkImageUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const imageSource = raw.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/i)?.[1];
  return (imageSource || raw).replaceAll("&amp;", "&").trim();
}
function updateHotlinkStatus() {
  const field = artForm.elements.previewUrl;
  const status = document.querySelector("#hotlink-status");
  const extracted = extractHotlinkImageUrl(field.value);
  if (!extracted) {
    status.textContent = "Waiting for a Postimages hotlink.";
    status.classList.remove("valid");
    return;
  }
  try {
    const url = new URL(extracted);
    if (url.protocol !== "https:" || !["i.postimg.cc", "postimg.cc"].includes(url.hostname.toLowerCase())) throw new Error();
    status.textContent = `Accepted preview image: ${url.href}`;
    status.classList.add("valid");
  } catch {
    status.textContent = "This is not a valid Postimages Hotlink for websites code or HTTPS image URL.";
    status.classList.remove("valid");
  }
}
artForm.elements.previewUrl.addEventListener("input", updateHotlinkStatus);
// SECTION: Administrator authentication and dashboard loading
async function showDashboard() {
  loginPanel.hidden = true;
  dashboard.hidden = false;
  await loadItems();
  await loadDashboard();
}
async function session() {
  try {
    await request("/api/admin/session");
    await showDashboard();
  } catch {
    loginPanel.hidden = false;
    dashboard.hidden = true;
  }
}
loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("#login-message", "Signing in\u2026", true);
  try {
    await request("/api/admin/login", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(loginForm))) });
    await showDashboard();
  } catch (error) {
    showMessage("#login-message", error.message);
  }
});
async function loadDashboard() {
  const data = await request("/api/admin/dashboard");
  const published = items.filter((item) => item.status === "published").length;
  const paid = data.orderStats.find((row) => row.status === "paid")?.total || 0;
  document.querySelector("#stats").innerHTML = `<div><span>Listings</span><strong>${items.length}</strong><small>${published} published</small></div><div><span>Articles</span><strong>${data.articles.length}</strong><small>${data.articles.filter((item) => item.status === "published").length} published</small></div><div><span>Paid orders</span><strong>${paid}</strong><small>Webhook verified</small></div><div><span>Access</span><strong>1</strong><small>Loren Weirich only</small></div>`;
  document.querySelector("#admin-articles").innerHTML = data.articles.map((article) => `<div class="article-admin-row"><div><strong>${clean(article.title)}</strong><small>${clean(article.status)}</small></div><button data-article="${article.id}" data-next="${article.status === "published" ? "draft" : "published"}">${article.status === "published" ? "Unpublish" : "Publish"}</button></div>`).join("") || "<p>No articles yet.</p>";
  document.querySelector("#admin-orders").innerHTML = data.orders.length ? data.orders.map((order) => `
    <div class="order-row">
      <div>
        <strong>#${order.id} \xB7 ${clean(order.title)}</strong>
        <small>${clean(order.category)} \xB7 $${Number(order.amount).toFixed(2)} \xB7 ${clean(order.status)}</small>
        <small>${order.buyerEmail ? `Delivery: ${clean(order.buyerEmail)} \xB7 ` : ""}${clean(order.fulfillmentStatus)}</small>
      </div>
      ${order.category === "NFT" && order.status === "paid" && order.fulfillmentStatus !== "email_sent" ? `<button data-fulfilled="${order.id}">Mark ZIP emailed</button>` : ""}
    </div>
  `).join("") : "<p>No orders yet.</p>";
}
// SECTION: Public watermarked-hotlink rendering and image-dimension inspection
async function loadItems() {
  items = await request("/api/admin/artworks");
  adminCatalog.innerHTML = items.length ? items.map((item) => `<article class="admin-item"><img class="admin-thumb" src="${clean(item.previewUrl || "assets/art-portrait.png")}" alt=""><div><strong>${clean(item.title)}</strong><small>${clean(item.artist)} \xB7 ${clean(item.category)} \xB7 $${Number(item.price).toFixed(2)}</small><small>Serial: ${clean(item.serialNumber)} \xB7 Display: ${item.displayWidth} \xD7 ${item.displayHeight}px \xB7 Hotlink image: <span data-size-url="${clean(item.previewUrl || "")}">detecting\u2026</span> \xB7 ${clean(item.status)}</small><small>Private original PNG: ${item.hasOriginal ? "stored securely" : "not stored"}</small></div><div class="item-actions"><button data-edit="${item.id}">Edit</button><button class="archive" data-status="${item.id}">${item.status === "published" ? "Archive" : "Publish"}</button></div></article>`).join("") : "<p>No listings yet.</p>";
  adminCatalog.querySelectorAll("[data-size-url]").forEach((span) => {
    if (!span.dataset.sizeUrl) {
      span.textContent = "built-in preview";
      return;
    }
    const image = new Image();
    image.onload = () => span.textContent = `${image.naturalWidth} \xD7 ${image.naturalHeight}px`;
    image.onerror = () => span.textContent = "unavailable";
    image.src = span.dataset.sizeUrl;
  });
}
// SECTION: Catalog creation and editing with private-original inputs cleared by default
adminCatalog.addEventListener("click", async (event) => {
  const edit = event.target.closest("[data-edit]"), status = event.target.closest("[data-status]");
  if (edit) {
    const item = items.find((value) => value.id === Number(edit.dataset.edit));
    ["id", "title", "artist", "serialNumber", "category", "price", "previewUrl", "displayWidth", "displayHeight", "status"].forEach((name) => {
      artForm.elements[name].value = item[name] ?? "";
    });
    artForm.elements.originalKey.value = "";
    updateHotlinkStatus();
    document.querySelector("#save-button").textContent = "Save listing changes";
    cancelEdit.hidden = false;
    artForm.scrollIntoView({ behavior: "smooth" });
  }
  if (status) {
    const item = items.find((value) => value.id === Number(status.dataset.status));
    try {
      await request(`/api/admin/artworks/${item.id}`, { method: "PATCH", body: JSON.stringify({ status: item.status === "published" ? "archived" : "published" }) });
      await loadItems();
      await loadDashboard();
    } catch (error) {
      alert(error.message);
    }
  }
});
artForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(artForm)), id = values.id;
  values.previewUrl = extractHotlinkImageUrl(values.previewUrl);
  try {
    await request(id ? `/api/admin/artworks/${id}` : "/api/admin/artworks", { method: id ? "PUT" : "POST", body: JSON.stringify(values) });
    artForm.reset();
    artForm.elements.displayWidth.value = 600;
    artForm.elements.displayHeight.value = 250;
    cancelEdit.hidden = true;
    document.querySelector("#save-button").textContent = "Publish listing";
    showMessage("#form-message", "Listing saved.", true);
    updateHotlinkStatus();
    await loadItems();
    await loadDashboard();
  } catch (error) {
    showMessage("#form-message", error.message);
  }
});
cancelEdit.addEventListener("click", () => {
  artForm.reset();
  artForm.elements.displayWidth.value = 600;
  artForm.elements.displayHeight.value = 250;
  cancelEdit.hidden = true;
  document.querySelector("#save-button").textContent = "Publish listing";
  updateHotlinkStatus();
});
// SECTION: Editorial article management
document.querySelector("#article-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await request("/api/admin/articles", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    event.currentTarget.reset();
    showMessage("#article-message", "Article published.", true);
    await loadDashboard();
  } catch (error) {
    showMessage("#article-message", error.message);
  }
});
document.querySelector("#admin-articles").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-article]");
  if (!button) return;
  await request(`/api/admin/articles/${button.dataset.article}`, { method: "PATCH", body: JSON.stringify({ status: button.dataset.next }) });
  await loadDashboard();
});
// SECTION: NFT email-fulfillment order management
document.querySelector("#admin-orders").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-fulfilled]");
  if (!button) return;
  await request(`/api/admin/orders/${button.dataset.fulfilled}/fulfilled`, {
    method: "PATCH",
    body: JSON.stringify({})
  });
  await loadDashboard();
});
// SECTION: Administrator session and password controls
document.querySelector("#logout-button").addEventListener("click", async () => {
  await request("/api/admin/logout", { method: "POST" });
  location.reload();
});
const dialog = document.querySelector("#password-dialog");
document.querySelector("#change-password-button").addEventListener("click", () => dialog.showModal());
document.querySelector("#close-password").addEventListener("click", () => dialog.close());
document.querySelector("#password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await request("/api/admin/password", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    alert("Password changed. Please sign in again.");
    location.reload();
  } catch (error) {
    showMessage("#password-message", error.message);
  }
});
session();
