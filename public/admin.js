// SECTION: Dashboard state and shared helpers
import { supabase } from "./supabase-client.js";
const loginPanel = document.querySelector("#login-panel");
const dashboard = document.querySelector("#dashboard");
const loginForm = document.querySelector("#login-form");
const artForm = document.querySelector("#art-form");
const adminCatalog = document.querySelector("#admin-catalog");
const cancelEdit = document.querySelector("#cancel-edit");
let items = [];
let editingArtworkId = null;
let orders = [];
let messages = [];
let articles = [];
const LOCAL_SIGNER_URL = "http://127.0.0.1:4179";

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

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function pemToBytes(pem) {
  const base64 = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s/g, "");
  if (!base64) throw new Error("The selected signing key is empty or invalid.");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

async function importPrivateSigningKey(file) {
  const keyData = pemToBytes(await file.text());
  return crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
}

async function importPublicSigningKey(file) {
  const keyData = pemToBytes(await file.text());
  return crypto.subtle.importKey(
    "spki",
    keyData,
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["verify"]
  );
}

function identityPayload({ serialNumber, creator, sha256 }) {
  return JSON.stringify({
    version: 1,
    serialNumber,
    creator,
    sha256
  });
}

async function createSignatureRecord(originalFile, formData) {
  const privateKeyFile = formData.get("privateSigningKey");
  const publicKeyFile = formData.get("publicSigningKey");

  if (!(privateKeyFile instanceof File) || !privateKeyFile.size) {
    throw new Error("Select the private PKCS#8 signing key.");
  }
  if (!(publicKeyFile instanceof File) || !publicKeyFile.size) {
    throw new Error("Select the public SPKI signing key.");
  }
  const [privateKey, publicKey, fileBytes] = await Promise.all([
    importPrivateSigningKey(privateKeyFile),
    importPublicSigningKey(publicKeyFile),
    originalFile.arrayBuffer()
  ]);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", fileBytes));
  const sha256 = bytesToHex(digest);
  const serialNumber = formData.get("serialNumber").trim().toUpperCase();
  const creator = formData.get("artist").trim();
  const payload = identityPayload({ serialNumber, creator, sha256 });
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(payload)
  ));
  const verified = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    signature,
    new TextEncoder().encode(payload)
  );
  if (!verified) {
    throw new Error("The public key does not match the selected private key.");
  }

  return {
    serial_number: serialNumber,
    creator,
    sha256,
    signature: bytesToBase64(signature),
    public_key_jwk: await crypto.subtle.exportKey("jwk", publicKey),
    payload_version: 1,
    mime_type: originalFile.type || "application/octet-stream",
    file_size: originalFile.size,
    c2pa_embedded: true,
    signed_at: new Date().toISOString()
  };
}

// SECTION: Local C2PA signing helper
async function signOriginalLocally(originalFile, formData) {
  const token = formData.get("signingHelperToken").trim();
  if (!token) throw new Error("Paste the access token printed by the local signing helper.");

  let response;
  try {
    response = await fetch(`${LOCAL_SIGNER_URL}/sign`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": originalFile.type || "application/octet-stream",
        "X-Artwork-Title": encodeURIComponent(formData.get("title").trim()),
        "X-Artwork-Serial": encodeURIComponent(formData.get("serialNumber").trim().toUpperCase()),
        "X-Artwork-Creator": encodeURIComponent(formData.get("artist").trim()),
        "X-Artwork-Filename": encodeURIComponent(originalFile.name)
      },
      body: originalFile
    });
  } catch {
    throw new Error("Cannot connect to the local signing helper. Start tools\\start-signing-helper.ps1 and allow local-network access in the browser.");
  }

  if (!response.ok) {
    const details = await response.json().catch(() => ({ error: "The local signing helper failed." }));
    throw new Error(details.error || "The local signing helper failed.");
  }

  const signedBlob = await response.blob();
  const signedName = decodeURIComponent(
    response.headers.get("X-Signed-Filename") ||
    `${formData.get("serialNumber").trim().toUpperCase()}.${originalFile.name.split(".").pop()}`
  );
  sessionStorage.setItem("pixelShroomSigningToken", token);
  return new File([signedBlob], signedName, {
    type: signedBlob.type || originalFile.type,
    lastModified: Date.now()
  });
}

async function checkLocalSigner() {
  const status = document.querySelector("#signature-status");
  try {
    const response = await fetch(`${LOCAL_SIGNER_URL}/health`, { cache: "no-store" });
    if (!response.ok) throw new Error();
    status.textContent = "Local C2PA signing helper is ready.";
    status.classList.add("success");
  } catch {
    status.textContent = "Local signing helper is offline. Run tools\\start-signing-helper.ps1 before publishing.";
    status.classList.remove("success");
  }
}

async function rowsFrom(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

async function saveRow(table, row, id = null) {
  const query = id === null
    ? supabase.from(table).insert(row)
    : supabase.from(table).update(row).eq("id", id);
  const { error } = await query;
  if (error) throw error;
}

async function saveArtwork(row, id = null) {
  const query = id === null
    ? supabase.from("artworks").insert(row)
    : supabase.from("artworks").update(row).eq("id", id);
  const { data, error } = await query.select("id").single();
  if (error) throw error;
  return data.id;
}

async function saveSignature(artworkId, signatureRecord) {
  const { error } = await supabase
    .from("artwork_signatures")
    .upsert(
      { artwork_id: artworkId, ...signatureRecord },
      { onConflict: "artwork_id" }
    );
  if (error) throw error;
}

// SECTION: Sole-administrator authorization
async function requireAdmin() {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error("Sign in required.");
  const { data, error } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !data) throw new Error("This account is not an administrator.");
  return user;
}

// SECTION: Image reading and permanent watermark generation
async function readImage(file) {
  if (!(file instanceof File) || !file.size) {
    throw new Error("Select an original image file.");
  }

  try {
    const bitmap = await createImageBitmap(file);
    return { source: bitmap, width: bitmap.width, height: bitmap.height };
  } catch {
    throw new Error(`Could not decode ${file.name}. Confirm that it is a valid PNG, JPEG, or WebP image.`);
  }
}

function toBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("Could not generate the protected preview.")),
    "image/webp",
    0.82
  ));
}

function coverWithWatermark(context, width, height, serialNumber) {
  // SECTION: Large, evenly spaced full-image watermark pattern
  // Keep each watermark block proportional to the artwork so portrait,
  // landscape, and square images receive the same visual coverage.
  const shortestSide = Math.min(width, height);
  const tileSize = Math.max(240, Math.round(shortestSide * 0.46));
  const tile = document.createElement("canvas");
  tile.width = tileSize;
  tile.height = tileSize;
  const tileContext = tile.getContext("2d");
  const fontSize = Math.max(19, Math.round(tileSize * 0.09));
  const lineSpacing = Math.round(fontSize * 1.18);

  tileContext.translate(tileSize / 2, tileSize / 2);
  tileContext.rotate(-Math.PI / 4);
  tileContext.textAlign = "center";
  tileContext.textBaseline = "middle";
  tileContext.font = `800 ${fontSize}px Arial, sans-serif`;
  tileContext.lineJoin = "round";
  tileContext.lineWidth = Math.max(2, fontSize * 0.1);
  tileContext.strokeStyle = "rgba(0,0,0,.76)";
  tileContext.fillStyle = "rgba(255,255,255,.72)";

  ["PIXEL SHROOM STUDIO", "PROTECTED PREVIEW", serialNumber].forEach((line, index) => {
    const y = (index - 1) * lineSpacing;
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
  const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  context.drawImage(image.source, 0, 0, width, height);
  coverWithWatermark(context, width, height, serialNumber);
  const blob = await toBlob(canvas);
  image.source.close();
  return { blob, width: image.width, height: image.height };
}

// SECTION: Private original and public derivative uploads
async function uploadFiles(formData, current) {
  const originalFile = formData.get("originalFile");
  if (!(originalFile instanceof File) || !originalFile.size) {
    if (!current?.preview_url || !current?.original_path) throw new Error("Select the serialized original image.");
    return {
      previewUrl: current.preview_url,
      originalPath: current.original_path,
      width: current.display_width,
      height: current.display_height,
      signatureRecord: null
    };
  }

  const serial = formData.get("serialNumber").trim().toUpperCase();
  const signedOriginal = await signOriginalLocally(originalFile, formData);
  const [preview, signatureRecord] = await Promise.all([
    generatePreview(signedOriginal, serial),
    createSignatureRecord(signedOriginal, formData)
  ]);
  const previewFile = new File([preview.blob], "protected-preview.webp", { type: "image/webp" });
  const previewPath = objectName("artworks", previewFile.name);
  const originalPath = objectName("artworks", signedOriginal.name);

  const { error: previewError } = await supabase.storage
    .from("previews")
    .upload(previewPath, previewFile, { contentType: previewFile.type, upsert: false });
  if (previewError) throw previewError;

  const { error: originalError } = await supabase.storage
    .from("originals")
    .upload(originalPath, signedOriginal, { contentType: signedOriginal.type, upsert: false });
  if (originalError) throw originalError;

  const { data: publicPreview } = supabase.storage.from("previews").getPublicUrl(previewPath);

  return {
    previewPath,
    previewUrl: publicPreview.publicUrl,
    originalPath,
    width: preview.width,
    height: preview.height,
    signatureRecord
  };
}

// SECTION: Catalog and dashboard data
async function loadItems() {
  const [artworkRows, signatureRows] = await Promise.all([
    rowsFrom(
      supabase
        .from("artworks")
        .select("*")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
    ),
    rowsFrom(supabase.from("artwork_signatures").select("artwork_id,sha256,c2pa_embedded,signed_at"))
  ]);
  const signaturesByArtwork = new Map(signatureRows.map((entry) => [String(entry.artwork_id), entry]));
  items = artworkRows.map((item) => ({
    ...item,
    signature_record: signaturesByArtwork.get(String(item.id)) || null
  }));
  adminCatalog.innerHTML = items.length ? items.map((item) => `
    <article class="admin-item">
      <img class="admin-thumb" src="${clean(item.preview_url)}" alt="${clean(item.title)} protected preview">
      <div>
        <strong>${clean(item.title)}</strong>
        <small>${clean(item.artist)} · ${clean(item.category)} · $${Number(item.price).toFixed(2)}</small>
        <small>${clean(item.serial_number)} · ${item.display_width} × ${item.display_height}px · ${clean(item.status)}</small>
        <small>Private original: ${item.original_path ? "stored securely" : "not stored"}</small>
        <small>Authenticity: ${item.signature_record ? "SHA-256 + P-256 signature registered" : "not registered"}</small>
        ${item.signature_record ? `<small><a href="/verify.html?serial=${encodeURIComponent(item.serial_number)}" target="_blank" rel="noopener">Open public verification</a></small>` : ""}
      </div>
      <div class="item-actions">
        <button data-edit="${item.id}">Edit</button>
        <button data-toggle="${item.id}">${item.status === "published" ? "Archive" : "Publish"}</button>
        <button class="delete" data-delete="${item.id}" aria-label="Delete ${clean(item.title)} from the site">Delete</button>
      </div>
    </article>`).join("") : "<p>No listings yet.</p>";
}

function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0));
}

function shortDate(value) {
  return value ? new Date(value).toLocaleDateString([], { month: "short", day: "numeric" }) : "—";
}

function customerRecords() {
  const customers = new Map();
  orders.filter((order) => order.status === "paid" && order.buyer_email).forEach((order) => {
    const email = order.buyer_email.trim().toLowerCase();
    const record = customers.get(email) || { email, purchases: [], total: 0, lastPurchase: null };
    record.purchases.push(order.artworks?.title || "Artwork");
    record.total += Number(order.amount || 0);
    if (!record.lastPurchase || new Date(order.created_at) > new Date(record.lastPurchase)) record.lastPurchase = order.created_at;
    customers.set(email, record);
  });
  return [...customers.values()].sort((a, b) => new Date(b.lastPurchase) - new Date(a.lastPurchase));
}

function renderStats(target, customers) {
  const paidOrders = orders.filter((order) => order.status === "paid");
  const revenue = paidOrders.reduce((total, order) => total + Number(order.amount || 0), 0);
  document.querySelector(target).innerHTML = `
    <div><strong>${customers.length}</strong><span>Total customers</span></div>
    <div><strong>${orders.length}</strong><span>Total orders</span></div>
    <div><strong>${money(revenue)}</strong><span>Verified revenue</span></div>
    <div><strong>${items.length}</strong><span>Images listed</span></div>`;
}

function sevenDaySales() {
  const days = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - offset));
    return { key: date.toISOString().slice(0, 10), label: date.toLocaleDateString([], { weekday: "short" }), total: 0 };
  });
  const byDay = new Map(days.map((day) => [day.key, day]));
  orders.filter((order) => order.status === "paid").forEach((order) => {
    const key = new Date(order.paid_at || order.created_at).toISOString().slice(0, 10);
    if (byDay.has(key)) byDay.get(key).total += Number(order.amount || 0);
  });
  return days;
}

function renderSalesChart(selector) {
  const chart = document.querySelector(selector);
  const days = sevenDaySales();
  const highest = Math.max(...days.map((day) => day.total), 1);
  chart.innerHTML = days.map((day) => `
    <div class="sales-bar"><em>${day.total ? money(day.total) : ""}</em><i style="height:${Math.max(4, (day.total / highest) * 82)}%"></i><b>${day.label}</b></div>`).join("");
}

function normalizedOrderState(order) {
  if (["failed", "canceled", "expired"].includes(order.status)) return "Failed";
  if (order.fulfillment_status === "emailed") return "Delivered";
  if (["ready", "delivered"].includes(order.fulfillment_status)) return "Ready";
  if (order.status === "paid") return "Paid";
  return "Pending";
}

function renderOrderStatus(donutSelector, legendSelector) {
  const colors = { Delivered: "#4d806c", Ready: "#d6a94f", Paid: "#866b39", Pending: "#d88942", Failed: "#a75b46" };
  const counts = orders.reduce((result, order) => {
    const state = normalizedOrderState(order); result[state] = (result[state] || 0) + 1; return result;
  }, {});
  const total = Math.max(orders.length, 1);
  let cursor = 0;
  const slices = Object.entries(colors).map(([state, color]) => {
    const start = cursor; cursor += ((counts[state] || 0) / total) * 100; return `${color} ${start}% ${cursor}%`;
  });
  const donut = document.querySelector(donutSelector);
  donut.style.background = orders.length ? `conic-gradient(${slices.join(",")})` : "#eee8f1";
  donut.innerHTML = `<span>${orders.length}<small>orders</small></span>`;
  document.querySelector(legendSelector).innerHTML = Object.entries(colors).map(([state, color]) => `
    <div><i style="background:${color}"></i><span>${state}</span><b>${counts[state] || 0}</b></div>`).join("");
}

function orderRows(source) {
  return source.map((order) => `
    <div class="admin-data-row">
      <strong>${clean(order.artworks?.title || "Artwork")}</strong>
      <span>${clean(order.buyer_email || "Email not supplied")}</span>
      <span class="status-pill ${clean(normalizedOrderState(order).toLowerCase())}">${clean(normalizedOrderState(order))}</span>
      <span>${money(order.amount)}</span>
    </div>`).join("");
}

function renderCustomers(customers) {
  document.querySelector("#admin-customers").innerHTML = customers.length ? `
    <div class="admin-data-row customer-row header"><span>Email</span><span>Orders</span><span>Images purchased</span><span>Total</span></div>
    ${customers.map((customer) => `<div class="admin-data-row customer-row"><strong>${clean(customer.email)}</strong><span>${customer.purchases.length}</span><span>${customer.purchases.map(clean).join(", ")}</span><span>${money(customer.total)}</span></div>`).join("")}` : "<p>No paid customer purchases yet.</p>";
}

function renderMessages() {
  const unread = messages.filter((message) => !message.is_read).length;
  const badge = document.querySelector("#message-badge");
  badge.hidden = unread === 0; badge.textContent = unread;
  document.querySelector("#dashboard-message-preview").innerHTML = messages.slice(0, 4).map((message) => `
    <div class="message-snippet"><div><strong>${clean(message.subject || "Customer message")}</strong><span>${clean(message.email)}</span></div><time>${shortDate(message.created_at)}</time></div>`).join("") || "<p>No customer messages yet.</p>";
  document.querySelector("#admin-messages").innerHTML = messages.map((message) => `
    <article class="message-item ${message.is_read ? "" : "unread"}">
      <div class="message-meta"><strong>${clean(message.name)}</strong><a href="mailto:${encodeURIComponent(message.email)}">${clean(message.email)}</a><time>${new Date(message.created_at).toLocaleString()}</time></div>
      <h3>${clean(message.subject || "Customer message")}</h3><p>${clean(message.message)}</p>
      <div class="message-actions"><a class="button" href="mailto:${encodeURIComponent(message.email)}?subject=${encodeURIComponent(`Re: ${message.subject || "Your Pixel Shroom Studio message"}`)}">Reply by email</a>${message.is_read ? "" : `<button type="button" class="secondary" data-message-read="${message.id}">Mark read</button>`}</div>
    </article>`).join("") || "<p>No customer messages yet.</p>";
}

async function loadDashboard() {
  [articles, orders, messages] = await Promise.all([
    rowsFrom(supabase.from("articles").select("*").order("created_at", { ascending: false })),
    rowsFrom(supabase.from("orders").select("*,artworks(title,category,serial_number)").order("created_at", { ascending: false }).limit(250)),
    rowsFrom(supabase.from("contact_messages").select("*").order("created_at", { ascending: false }).limit(250))
  ]);
  const customers = customerRecords();
  renderStats("#stats", customers); renderStats("#analytics-stats", customers);
  renderSalesChart("#dashboard-sales-chart"); renderSalesChart("#analytics-sales-chart");
  renderOrderStatus("#dashboard-status-donut", "#dashboard-status-legend");
  renderOrderStatus("#analytics-status-donut", "#analytics-status-legend");
  renderCustomers(customers); renderMessages();
  document.querySelector("#admin-recent-orders").innerHTML = orders.length
    ? `<div class="admin-data-row header"><span>Image</span><span>Customer</span><span>Status</span><span>Amount</span></div>${orderRows(orders.slice(0, 6))}`
    : "<p>No orders yet.</p>";
  document.querySelector("#admin-orders").innerHTML = orders.length
    ? `<div class="admin-data-row header"><span>Image</span><span>Customer</span><span>Status</span><span>Amount</span></div>${orderRows(orders)}`
    : "<p>No orders yet.</p>";
  document.querySelector("#admin-articles").innerHTML = articles.map((article) => `<div class="article-admin-row"><strong>${clean(article.title)}</strong><button data-article="${article.id}" data-next="${article.status === "published" ? "draft" : "published"}">${article.status === "published" ? "Unpublish" : "Publish"}</button></div>`).join("") || "<p>No articles yet.</p>";
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
  const savedSigningToken = sessionStorage.getItem("pixelShroomSigningToken") || "";
  editingArtworkId = null;
  artForm.reset();
  artForm.elements.signingHelperToken.value = savedSigningToken;
  artForm.elements.displayWidth.value = 600;
  artForm.elements.displayHeight.value = 600;
  cancelEdit.hidden = true;
  document.querySelector("#art-form-title").textContent = "Add artwork or NFT";
  document.querySelector("#save-button").textContent = "Publish new listing";
  document.querySelector("#original-status").textContent = "No original selected.";
  checkLocalSigner();
}

artForm.elements.originalFile.addEventListener("change", async () => {
  const file = artForm.elements.originalFile.files[0];
  const status = document.querySelector("#original-status");
  if (!file) { status.textContent = "No original selected."; return; }
  try {
    const image = await readImage(file);
    artForm.elements.displayWidth.value = image.width;
    artForm.elements.displayHeight.value = image.height;
    status.textContent = `Selected: ${file.name} · ${image.width} × ${image.height}px`;
    document.querySelector("#signature-status").textContent = "Ready to create C2PA, SHA-256, and studio signatures when you publish.";
    image.source.close();
  } catch (error) { status.textContent = error.message; }
});

// SECTION: Authentication
loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("#login-message", "Signing in…", true);
  const values = new FormData(loginForm);
  try {
    const { error } = await supabase.auth.signInWithPassword({
      email: values.get("email"),
      password: values.get("password")
    });
    if (error) throw error;
    await showDashboard();
  } catch (error) {
    await supabase.auth.signOut();
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
      status: current?.status || "published", preview_url: files.previewUrl,
      original_path: files.originalPath, updated_at: new Date().toISOString()
    };
    const wasEditing = Boolean(editingArtworkId);
    const artworkId = await saveArtwork(row, wasEditing ? editingArtworkId : null);
    if (files.signatureRecord) {
      await saveSignature(artworkId, files.signatureRecord);
    }
    resetArtworkForm();
    showMessage(
      "#form-message",
      files.signatureRecord
        ? `${wasEditing ? "Listing updated" : "Listing created"} and cryptographic identity registered.`
        : `${wasEditing ? "Listing updated" : "Listing created"}.`,
      true
    );
    await loadItems();
    await loadDashboard();
  } catch (error) { showMessage("#form-message", error.message); }
  finally { button.disabled = false; }
});

adminCatalog.addEventListener("click", async (event) => {
  const edit = event.target.closest("[data-edit]");
  const toggle = event.target.closest("[data-toggle]");
  const remove = event.target.closest("[data-delete]");
  if (edit) {
    const item = items.find((entry) => entry.id === Number(edit.dataset.edit));
    editingArtworkId = item.id;
    const values = { title: item.title, artist: item.artist, category: item.category, serialNumber: item.serial_number, price: item.price, displayWidth: item.display_width, displayHeight: item.display_height };
    Object.entries(values).forEach(([name, value]) => { artForm.elements.namedItem(name).value = value; });
    document.querySelector("#art-form-title").textContent = `Editing: ${item.title}`;
    document.querySelector("#save-button").textContent = "Save listing changes";
    cancelEdit.hidden = false;
    artForm.scrollIntoView({ behavior: "smooth" });
  }
  if (toggle) {
    const item = items.find((entry) => entry.id === Number(toggle.dataset.toggle));
    await saveRow("artworks", { status: item.status === "published" ? "archived" : "published" }, item.id);
    await loadItems(); await loadDashboard();
  }
  if (remove) {
    const item = items.find((entry) => entry.id === Number(remove.dataset.delete));
    if (!item) return;
    const confirmed = window.confirm(
      `Delete "${item.title}" from the site?\n\n` +
      "The listing will disappear from the storefront and Current images. " +
      "Supabase history, orders, signatures, and stored files will be preserved."
    );
    if (!confirmed) return;
    try {
      await requireAdmin();
      await saveRow(
        "artworks",
        {
          status: "archived",
          deleted_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        },
        item.id
      );
      if (editingArtworkId === item.id) resetArtworkForm();
      await loadItems();
      await loadDashboard();
    } catch (error) {
      alert(error.message || "The listing could not be deleted from the site.");
    }
  }
});

cancelEdit.addEventListener("click", resetArtworkForm);
document.querySelector("#new-listing-button").addEventListener("click", () => { resetArtworkForm(); artForm.scrollIntoView({ behavior: "smooth" }); });

// SECTION: Editorial controls
document.querySelector("#article-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  await saveRow("articles", { ...values, status: "published" });
  event.currentTarget.reset(); await loadDashboard();
});
document.querySelector("#admin-articles").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-article]");
  if (!button) return;
  await saveRow("articles", { status: button.dataset.next }, button.dataset.article);
  await loadDashboard();
});

// SECTION: Five-view dashboard navigation
function openAdminView(viewId) {
  document.querySelectorAll(".admin-view").forEach((view) => {
    const active = view.id === viewId;
    view.hidden = !active;
    view.classList.toggle("active", active);
  });
  document.querySelectorAll("[data-admin-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.adminView === viewId);
  });
  const view = document.querySelector(`#${CSS.escape(viewId)}`);
  document.querySelector("#view-heading").textContent = view?.dataset.title || "Dashboard";
  document.querySelector("#dashboard").classList.remove("sidebar-open");
  history.replaceState(null, "", `#${viewId}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelector(".admin-view-nav").addEventListener("click", (event) => {
  const button = event.target.closest("[data-admin-view]");
  if (button) openAdminView(button.dataset.adminView);
});
document.querySelector(".admin-main").addEventListener("click", (event) => {
  const button = event.target.closest("[data-open-view]");
  if (button) openAdminView(button.dataset.openView);
});
document.querySelector("#sidebar-toggle").addEventListener("click", () => {
  document.querySelector("#dashboard").classList.toggle("sidebar-open");
});

// SECTION: Quick action — invite an administrator
document.querySelector("#add-admin-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button");
  button.disabled = true;
  showMessage("#add-admin-message", "Sending invitation…", true);
  try {
    await requireAdmin();
    const { data, error } = await supabase.functions.invoke("add-admin-user", {
      body: { email: new FormData(form).get("email").trim().toLowerCase() }
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    form.reset();
    showMessage("#add-admin-message", "Administrator invitation sent.", true);
  } catch (error) {
    showMessage("#add-admin-message", error.message || "Could not invite the administrator.");
  } finally {
    button.disabled = false;
  }
});

// SECTION: Customer message controls
document.querySelector("#admin-messages").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-message-read]");
  if (!button) return;
  const { error } = await supabase.from("contact_messages").update({ is_read: true }).eq("id", button.dataset.messageRead);
  if (error) return alert(error.message);
  await loadDashboard();
});

// SECTION: Session and password controls
document.querySelector("#logout-button").addEventListener("click", async () => {
  await supabase.auth.signOut();
  location.reload();
});
const dialog = document.querySelector("#password-dialog");
document.querySelector("#change-password-button").addEventListener("click", () => dialog.showModal());
document.querySelector("#close-password").addEventListener("click", () => dialog.close());
document.querySelector("#password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const { error } = await supabase.auth.updateUser({ password: new FormData(event.currentTarget).get("newPassword") });
    if (error) throw error;
    await supabase.auth.signOut();
    location.reload();
  }
  catch (error) { showMessage("#password-message", error.message); }
});

// SECTION: Restore an existing authenticated session
showDashboard().catch(async () => {
  await supabase.auth.signOut();
  loginPanel.hidden = false;
  dashboard.hidden = true;
});

artForm.elements.signingHelperToken.value = sessionStorage.getItem("pixelShroomSigningToken") || "";
document.querySelector("#check-signing-helper").addEventListener("click", checkLocalSigner);
document.querySelector("#dashboard-date").textContent = new Date().toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
const requestedView = location.hash.slice(1);
if (document.getElementById(requestedView)?.classList.contains("admin-view")) openAdminView(requestedView);
