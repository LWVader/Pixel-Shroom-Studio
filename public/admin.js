import { mapArtwork, supabase } from "./supabase-client.js";

const loginPanel = document.querySelector("#login-panel"), dashboard = document.querySelector("#dashboard"), loginForm = document.querySelector("#login-form"), artForm = document.querySelector("#art-form"), adminCatalog = document.querySelector("#admin-catalog"), cancelEdit = document.querySelector("#cancel-edit");
let items = [], editingArtworkId = null;
const clean = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const showMessage = (selector, message, success = false) => { const element = document.querySelector(selector); element.textContent = message; element.classList.toggle("success", success); };
const extension = (file) => (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
const objectName = (prefix, file) => `${prefix}/${crypto.randomUUID()}.${extension(file)}`;

async function requireAdmin() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in required.");
  const { data, error } = await supabase.from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle();
  if (error || !data) throw new Error("This account is not an administrator.");
  return user;
}
async function upload(bucket, path, file) {
  const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
}
function updateFileStatus() {
  const file = artForm.elements.previewFile.files[0];
  document.querySelector("#hotlink-status").textContent = file ? `Selected: ${file.name}` : "No preview selected.";
}
artForm.elements.previewFile.addEventListener("change", updateFileStatus);

function resetArtworkForm() {
  editingArtworkId = null; artForm.reset();
  artForm.elements.displayWidth.value = 600; artForm.elements.displayHeight.value = 250;
  cancelEdit.hidden = true; document.querySelector("#art-form-title").textContent = "Add artwork or NFT"; document.querySelector("#save-button").textContent = "Publish new listing"; updateFileStatus();
}
async function loadItems() {
  const { data, error } = await supabase.from("artworks").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  items = data.map(mapArtwork);
  adminCatalog.innerHTML = items.length ? items.map((item) => `<article class="admin-item"><img class="admin-thumb" src="${clean(item.previewUrl || "assets/art-portrait.png")}" alt=""><div><strong>${clean(item.title)}</strong><small>${clean(item.artist)} · ${clean(item.category)} · $${item.price.toFixed(2)}</small><small>Serial: ${clean(item.serialNumber)} · ${clean(item.status)}</small><small>Private original: ${item.originalPath ? "stored securely" : "not stored"}</small></div><div class="item-actions"><button data-edit="${item.id}">Edit</button><button class="archive" data-status="${item.id}">${item.status === "published" ? "Archive" : "Publish"}</button></div></article>`).join("") : "<p>No listings yet.</p>";
}
async function loadDashboard() {
  const [{ data: articles, error: articleError }, { data: orders, error: orderError }] = await Promise.all([supabase.from("articles").select("*").order("created_at", { ascending: false }), supabase.from("orders").select("id,status,amount,buyer_email,fulfillment_status,created_at,artworks(title,category,serial_number)").order("created_at", { ascending: false }).limit(100)]);
  if (articleError) throw articleError; if (orderError) throw orderError;
  const paid = orders.filter((order) => order.status === "paid").length;
  document.querySelector("#stats").innerHTML = `<div><strong>${items.length}</strong><span>Listings</span></div><div><strong>${orders.length}</strong><span>Orders</span></div><div><strong>${paid}</strong><span>Paid</span></div>`;
  document.querySelector("#admin-articles").innerHTML = articles.map((article) => `<div class="article-admin-row"><div><strong>${clean(article.title)}</strong><small>${clean(article.status)}</small></div><button data-article="${article.id}" data-next="${article.status === "published" ? "draft" : "published"}">${article.status === "published" ? "Unpublish" : "Publish"}</button></div>`).join("") || "<p>No articles yet.</p>";
  document.querySelector("#admin-orders").innerHTML = orders.map((order) => `<div class="order-row"><div><strong>#${order.id} · ${clean(order.artworks?.title || "Artwork")}</strong><small>${clean(order.status)} · ${clean(order.fulfillment_status)} · $${Number(order.amount).toFixed(2)}</small></div>${order.fulfillment_status === "email_pending" ? `<button data-fulfilled="${order.id}">Mark emailed</button>` : ""}</div>`).join("") || "<p>No orders yet.</p>";
}
async function showDashboard() { await requireAdmin(); loginPanel.hidden = true; dashboard.hidden = false; await loadItems(); await loadDashboard(); }
async function session() { try { await showDashboard(); } catch { loginPanel.hidden = false; dashboard.hidden = true; } }
loginForm.addEventListener("submit", async (event) => {
  event.preventDefault(); showMessage("#login-message", "Signing in…", true);
  const values = Object.fromEntries(new FormData(loginForm));
  const { error } = await supabase.auth.signInWithPassword({ email: values.email, password: values.password });
  if (error) return showMessage("#login-message", error.message);
  try { await showDashboard(); } catch (authError) { await supabase.auth.signOut(); showMessage("#login-message", authError.message); }
});
document.querySelector("#new-listing-button").addEventListener("click", () => { resetArtworkForm(); artForm.scrollIntoView({ behavior: "smooth" }); });
adminCatalog.addEventListener("click", async (event) => {
  const edit = event.target.closest("[data-edit]"), status = event.target.closest("[data-status]");
  if (edit) {
    const item = items.find((entry) => entry.id === Number(edit.dataset.edit)); editingArtworkId = item.id;
    for (const [name, value] of Object.entries({ title: item.title, artist: item.artist, serialNumber: item.serialNumber, category: item.category, price: item.price, displayWidth: item.displayWidth, displayHeight: item.displayHeight, status: item.status })) artForm.elements[name].value = value;
    document.querySelector("#art-form-title").textContent = `Editing: ${item.title}`; document.querySelector("#save-button").textContent = "Save listing changes"; cancelEdit.hidden = false; artForm.scrollIntoView({ behavior: "smooth" });
  }
  if (status) { const item = items.find((entry) => entry.id === Number(status.dataset.status)); const { error } = await supabase.from("artworks").update({ status: item.status === "published" ? "archived" : "published" }).eq("id", item.id); if (error) alert(error.message); else { await loadItems(); await loadDashboard(); } }
});
artForm.addEventListener("submit", async (event) => {
  event.preventDefault(); const button = document.querySelector("#save-button"); button.disabled = true;
  try {
    await requireAdmin(); const values = Object.fromEntries(new FormData(artForm)); const current = items.find((item) => item.id === editingArtworkId);
    let previewUrl = current?.previewUrl || "", originalPath = current?.originalPath || "";
    const previewFile = artForm.elements.previewFile.files[0], originalFile = artForm.elements.originalFile.files[0];
    if (previewFile) { const path = objectName("previews", previewFile); await upload("previews", path, previewFile); previewUrl = supabase.storage.from("previews").getPublicUrl(path).data.publicUrl; }
    if (originalFile) { originalPath = objectName("originals", originalFile); await upload("originals", originalPath, originalFile); }
    if (!editingArtworkId && !previewUrl) throw new Error("A permanently watermarked preview is required.");
    const row = { title: values.title.trim(), artist: values.artist.trim(), serial_number: values.serialNumber.trim(), category: values.category, price: Number(values.price), display_width: Number(values.displayWidth), display_height: Number(values.displayHeight), status: values.status, preview_url: previewUrl, original_path: originalPath || null };
    const wasEditing = Boolean(editingArtworkId);
    const query = editingArtworkId ? supabase.from("artworks").update(row).eq("id", editingArtworkId) : supabase.from("artworks").insert(row);
    const { error } = await query; if (error) throw error;
    resetArtworkForm(); showMessage("#form-message", wasEditing ? "Listing updated." : "Listing created.", true); await loadItems(); await loadDashboard();
  } catch (error) { showMessage("#form-message", error.message); } finally { button.disabled = false; }
});
cancelEdit.addEventListener("click", resetArtworkForm);
document.querySelector("#article-form").addEventListener("submit", async (event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); const { error } = await supabase.from("articles").insert({ ...values, status: "published" }); if (error) showMessage("#article-message", error.message); else { event.currentTarget.reset(); showMessage("#article-message", "Article published.", true); await loadDashboard(); } });
document.querySelector("#admin-articles").addEventListener("click", async (event) => { const button = event.target.closest("[data-article]"); if (!button) return; await supabase.from("articles").update({ status: button.dataset.next }).eq("id", button.dataset.article); await loadDashboard(); });
document.querySelector("#admin-orders").addEventListener("click", async (event) => { const button = event.target.closest("[data-fulfilled]"); if (!button) return; await supabase.from("orders").update({ fulfillment_status: "emailed" }).eq("id", button.dataset.fulfilled); await loadDashboard(); });
document.querySelector("#logout-button").addEventListener("click", async () => { await supabase.auth.signOut(); location.reload(); });
const dialog = document.querySelector("#password-dialog"); document.querySelector("#change-password-button").addEventListener("click", () => dialog.showModal()); document.querySelector("#close-password").addEventListener("click", () => dialog.close());
document.querySelector("#password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget)), { data: { user } } = await supabase.auth.getUser();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email: user.email, password: values.currentPassword });
  if (signInError) return showMessage("#password-message", "Current password is incorrect.");
  const { error } = await supabase.auth.updateUser({ password: values.newPassword });
  if (error) showMessage("#password-message", error.message); else { await supabase.auth.signOut(); location.reload(); }
});
session();
