import {
  editionDisclosure,
  SIX_TIER_RATES,
  FOIL_TIERS,
} from "./mint-core.js?v=20261019-uploaded-tiers";
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
let savedTierAssets = [];
let tierAssetsLocked = false;
let orders = [];
let messages = [];
let articles = [];
const LOCAL_SIGNER_URL = "http://127.0.0.1:4179";

const clean = (value) =>
  String(value ?? "").replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[character],
  );

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
  return crypto.subtle.importKey("pkcs8", keyData, { name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
  ]);
}

async function importPublicSigningKey(file) {
  const keyData = pemToBytes(await file.text());
  return crypto.subtle.importKey("spki", keyData, { name: "ECDSA", namedCurve: "P-256" }, true, [
    "verify",
  ]);
}

function identityPayload({ serialNumber, creator, sha256 }) {
  return JSON.stringify({
    version: 1,
    serialNumber,
    creator,
    sha256,
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
    originalFile.arrayBuffer(),
  ]);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", fileBytes));
  const sha256 = bytesToHex(digest);
  const serialNumber = formData.get("serialNumber").trim().toUpperCase();
  const creator = formData.get("artist").trim();
  const payload = identityPayload({ serialNumber, creator, sha256 });
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      new TextEncoder().encode(payload),
    ),
  );
  const verified = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    signature,
    new TextEncoder().encode(payload),
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
    signed_at: new Date().toISOString(),
  };
}

async function standardSerial(file, formData) {
  const token = formData.get("signingHelperToken").trim();
  if (!token) throw Error("Paste the local signing-helper token before saving the Standard image.");
  let response;
  try {
    response = await fetch(`${LOCAL_SIGNER_URL}/image-info`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": file.type,
        "X-Artwork-Filename": encodeURIComponent(file.name),
      },
      body: file,
    });
  } catch {
    throw Error("Start the updated local signing helper to read the Standard image information.");
  }
  const info = await response.json().catch(() => ({}));
  if (!response.ok || !/^LWV-\d{10,11}$/.test(info.serial || ""))
    throw Error(
      info.error || "Restart the updated signing helper and check the Standard file information.",
    );
  return info.serial;
}

async function checkArtworkSerial(serial, artworkId) {
  const { data, error } = await supabase
    .from("artworks")
    .select("id,title,deleted_at")
    .eq("serial_number", serial)
    .limit(1);
  if (error) throw error;
  const existing = data?.[0];
  if (existing && String(existing.id) !== String(artworkId)) {
    throw Error(
      `${serial} belongs to “${existing.title}” (artwork ${existing.id}). ` +
        (existing.deleted_at
          ? "It is hidden. Use Preview permanent reset to see whether this record can be deleted."
          : "Edit that listing, or preview the permanent reset to remove unlinked records."),
    );
  }
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
        Authorization: `Bearer ${token}`,
        "Content-Type": originalFile.type || "application/octet-stream",
        "X-Artwork-Title": encodeURIComponent(formData.get("title").trim()),
        "X-Artwork-Serial": encodeURIComponent(formData.get("serialNumber").trim().toUpperCase()),
        "X-Artwork-Creator": encodeURIComponent(formData.get("artist").trim()),
        "X-Artwork-Filename": encodeURIComponent(originalFile.name),
      },
      body: originalFile,
    });
  } catch {
    throw new Error(
      "Cannot connect to the local signing helper. Start tools\\start-signing-helper.ps1 and allow local-network access in the browser.",
    );
  }

  if (!response.ok) {
    const details = await response
      .json()
      .catch(() => ({ error: "The local signing helper failed." }));
    throw new Error(details.error || "The local signing helper failed.");
  }

  const signedBlob = await response.blob();
  const signedName = decodeURIComponent(
    response.headers.get("X-Signed-Filename") ||
      `${formData.get("serialNumber").trim().toUpperCase()}.${originalFile.name.split(".").pop()}`,
  );
  sessionStorage.setItem("pixelShroomSigningToken", token);
  return new File([signedBlob], signedName, {
    type: signedBlob.type || originalFile.type,
    lastModified: Date.now(),
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
    status.textContent =
      "Local signing helper is offline. Run tools\\start-signing-helper.ps1 before publishing.";
    status.classList.remove("success");
  }
}

async function rowsFrom(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

async function saveRow(table, row, id = null) {
  const query =
    id === null ? supabase.from(table).insert(row) : supabase.from(table).update(row).eq("id", id);
  const { error } = await query;
  if (error) throw error;
}

async function saveArtwork(row, id = null) {
  const query =
    id === null
      ? supabase.from("artworks").insert(row)
      : supabase.from("artworks").update(row).eq("id", id);
  const { data, error } = await query.select("id").single();
  if (error) throw error;
  return data.id;
}

async function saveSignature(artworkId, signatureRecord) {
  const { error } = await supabase
    .from("artwork_signatures")
    .upsert({ artwork_id: artworkId, ...signatureRecord }, { onConflict: "artwork_id" });
  if (error) throw error;
}

// SECTION: Sole-administrator authorization
async function requireAdmin() {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
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
    throw new Error(
      `Could not decode ${file.name}. Confirm that it is a valid PNG, JPEG, or WebP image.`,
    );
  }
}

function toBlob(canvas) {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Could not generate the protected preview.")),
      "image/webp",
      0.82,
    ),
  );
}

function coverWithWatermark(context, width, height, serialNumber) {
  // SECTION: Uniform responsive coverage matching the approved preview
  // Keep each watermark stamp at the clean reference size. Larger canvases
  // receive more repeated stamps instead of larger lettering.
  // 226px is approximately 160 × √2, which cuts the total repeated-stamp
  // count in half while preserving the approved 14px lettering.
  const tileSize = 226;
  const tile = document.createElement("canvas");
  tile.width = tileSize;
  tile.height = tileSize;
  const tileContext = tile.getContext("2d");
  const fontSize = 14;
  const lineSpacing = 21;

  tileContext.translate(tileSize / 2, tileSize / 2);
  tileContext.rotate(-Math.PI / 4);
  tileContext.textAlign = "center";
  tileContext.textBaseline = "middle";
  tileContext.font = `700 ${fontSize}px Arial, sans-serif`;
  tileContext.lineJoin = "round";
  tileContext.lineWidth = 2;
  tileContext.strokeStyle = "rgba(0,0,0,.58)";
  tileContext.fillStyle = "rgba(255,255,255,.58)";

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
  // SECTION: Standardized public-preview canvas
  // Keep every generated preview inside the desktop preview viewport so the
  // fixed reference watermark is not shrunk after it is baked into the file.
  const maximumPreviewWidth = 960;
  const maximumPreviewHeight = 640;
  const scale = Math.min(1, maximumPreviewWidth / image.width, maximumPreviewHeight / image.height);
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
  return { blob, width, height, originalWidth: image.width, originalHeight: image.height };
}

// Compression happens locally, before creating any signature or tier hash.
const PNG_OPTIMIZATION_THRESHOLD = 9 * 1024 * 1024;
const MAX_ARTWORK_UPLOAD_BYTES = 100 * 1024 * 1024;

async function prepareArtworkUploads(values, includeTiers) {
  const tiers = includeTiers ? FOIL_TIERS : ["Standard"];
  const reductions = [];
  for (const tier of tiers) {
    const field = "tierImage" + tier;
    const file = values.get(field);
    if (!(file instanceof File) || !file.size) continue;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
      throw new Error(`${tier}: choose a PNG, JPEG or WebP file.`);
    if (file.type === "image/png" && file.size > PNG_OPTIMIZATION_THRESHOLD) {
      const token = values.get("signingHelperToken").trim();
      if (!token)
        throw new Error(`${tier}: paste the local signing-helper token to optimize the PNG.`);
      showMessage("#form-message", `Optimizing ${tier} PNG locally…`, true);
      let response;
      try {
        response = await fetch(`${LOCAL_SIGNER_URL}/optimize-png`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": file.type },
          body: file,
        });
      } catch {
        throw new Error(`${tier}: start the updated local signing helper to optimize the PNG.`);
      }
      if (!response.ok) {
        const details = await response.json().catch(() => ({}));
        throw new Error(
          `${tier}: ${response.status === 404 ? "restart the updated local signing helper." : details.error || "PNG optimization failed."}`,
        );
      }
      const blob = await response.blob();
      if (blob.type !== "image/png" || !blob.size)
        throw new Error(`${tier}: the signing helper did not return a valid PNG response.`);
      if (blob.size < file.size) {
        values.set(field, new File([blob], file.name, { type: file.type }));
        reductions.push(tier);
      }
    }
    if (values.get(field).size > MAX_ARTWORK_UPLOAD_BYTES)
      throw new Error(
        `${tier}: the file is still over 100 MiB. Export a smaller file at the same pixel dimensions and try again.`,
      );
  }
  return reductions;
}

function artworkUploadError(error, label, bucket, file) {
  if (
    Number(error.statusCode ?? error.status) === 413 ||
    /maximum allowed size|payload too large/i.test(error.message || "")
  ) {
    const size = (file.size / 1024 ** 2).toFixed(2);
    return new Error(
      `${label} is ${size} MiB. Supabase rejected it in ${bucket}. Check that bucket’s limit and the project-wide limit, or export a smaller source before signing.`,
    );
  }
  return error;
}

// SECTION: Private original and public derivative uploads
async function uploadFiles(formData, current) {
  const originalFile = formData.get("tierImageStandard");
  if (!(originalFile instanceof File) || !originalFile.size) {
    if (!current?.preview_url || !current?.original_path)
      throw new Error("Select the Standard image.");
    return {
      previewUrl: current.preview_url,
      originalPath: current.original_path,
      width: current.display_width,
      height: current.display_height,
      signatureRecord: null,
      originalWidth: current.original_width || null,
      originalHeight: current.original_height || null,
      originalFormat: current.original_format || null,
      dimensionsSource: current.original_dimensions_source || null,
    };
  }

  const serial = formData.get("serialNumber").trim().toUpperCase();
  const signedOriginal = await signOriginalLocally(originalFile, formData);
  const [preview, signatureRecord] = await Promise.all([
    generatePreview(signedOriginal, serial),
    createSignatureRecord(signedOriginal, formData),
  ]);
  const previewFile = new File([preview.blob], "protected-preview.webp", { type: "image/webp" });
  const previewPath = objectName("artworks", previewFile.name);
  const originalPath = objectName("artworks", signedOriginal.name);

  const { error: previewError } = await supabase.storage
    .from("previews")
    .upload(previewPath, previewFile, { contentType: previewFile.type, upsert: false });
  if (previewError)
    throw artworkUploadError(previewError, "Standard preview", "previews", previewFile);

  const { error: originalError } = await supabase.storage
    .from("originals")
    .upload(originalPath, signedOriginal, { contentType: signedOriginal.type, upsert: false });
  if (originalError)
    throw artworkUploadError(originalError, "Signed Standard", "originals", signedOriginal);

  const { data: publicPreview } = supabase.storage.from("previews").getPublicUrl(previewPath);

  return {
    previewPath,
    previewUrl: publicPreview.publicUrl,
    originalPath,
    width: preview.width,
    height: preview.height,
    signatureRecord,
    originalWidth: preview.originalWidth,
    originalHeight: preview.originalHeight,
    originalFormat: signedOriginal.type,
    dimensionsSource: "decoded",
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
        .order("created_at", { ascending: false }),
    ),
    rowsFrom(
      supabase.from("artwork_signatures").select("artwork_id,sha256,c2pa_embedded,signed_at"),
    ),
  ]);
  const signaturesByArtwork = new Map(
    signatureRows.map((entry) => [String(entry.artwork_id), entry]),
  );
  items = artworkRows.map((item) => ({
    ...item,
    signature_record: signaturesByArtwork.get(String(item.id)) || null,
  }));
  adminCatalog.innerHTML = items.length
    ? items
        .map(
          (item) => `
    <article class="admin-item">
      <img class="admin-thumb" src="${clean(item.preview_url)}" alt="${clean(item.title)} protected preview">
      <div>
        <strong>${clean(item.title)}</strong>
        <small>${clean(item.artist)} · ${clean(item.category)}</small>
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
    </article>`,
        )
        .join("")
    : "<p>No listings yet.</p>";
}

function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number(value || 0),
  );
}

function shortDate(value) {
  return value ? new Date(value).toLocaleDateString([], { month: "short", day: "numeric" }) : "—";
}

function customerRecords() {
  const customers = new Map();
  orders
    .filter((order) => order.status === "paid" && order.buyer_email)
    .forEach((order) => {
      const email = order.buyer_email.trim().toLowerCase();
      const record = customers.get(email) || { email, purchases: [], total: 0, lastPurchase: null };
      record.purchases.push(order.artworks?.title || "Artwork");
      record.total += Number(order.amount || 0);
      if (!record.lastPurchase || new Date(order.created_at) > new Date(record.lastPurchase))
        record.lastPurchase = order.created_at;
      customers.set(email, record);
    });
  return [...customers.values()].sort(
    (a, b) => new Date(b.lastPurchase) - new Date(a.lastPurchase),
  );
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
    return {
      key: date.toISOString().slice(0, 10),
      label: date.toLocaleDateString([], { weekday: "short" }),
      total: 0,
    };
  });
  const byDay = new Map(days.map((day) => [day.key, day]));
  orders
    .filter((order) => order.status === "paid")
    .forEach((order) => {
      const key = new Date(order.paid_at || order.created_at).toISOString().slice(0, 10);
      if (byDay.has(key)) byDay.get(key).total += Number(order.amount || 0);
    });
  return days;
}

function renderSalesChart(selector) {
  const chart = document.querySelector(selector);
  const days = sevenDaySales();
  const highest = Math.max(...days.map((day) => day.total), 1);
  chart.innerHTML = days
    .map(
      (day) => `
    <div class="sales-bar"><em>${day.total ? money(day.total) : ""}</em><i style="height:${Math.max(4, (day.total / highest) * 82)}%"></i><b>${day.label}</b></div>`,
    )
    .join("");
}

function normalizedOrderState(order) {
  if (["failed", "canceled", "expired"].includes(order.status)) return "Failed";
  if (order.fulfillment_status === "emailed") return "Delivered";
  if (["ready", "delivered"].includes(order.fulfillment_status)) return "Ready";
  if (order.status === "paid") return "Paid";
  return "Pending";
}

function renderOrderStatus(donutSelector, legendSelector) {
  const colors = {
    Delivered: "#4d806c",
    Ready: "#d6a94f",
    Paid: "#866b39",
    Pending: "#d88942",
    Failed: "#a75b46",
  };
  const counts = orders.reduce((result, order) => {
    const state = normalizedOrderState(order);
    result[state] = (result[state] || 0) + 1;
    return result;
  }, {});
  const total = Math.max(orders.length, 1);
  let cursor = 0;
  const slices = Object.entries(colors).map(([state, color]) => {
    const start = cursor;
    cursor += ((counts[state] || 0) / total) * 100;
    return `${color} ${start}% ${cursor}%`;
  });
  const donut = document.querySelector(donutSelector);
  donut.style.background = orders.length ? `conic-gradient(${slices.join(",")})` : "#eee8f1";
  donut.innerHTML = `<span>${orders.length}<small>orders</small></span>`;
  document.querySelector(legendSelector).innerHTML = Object.entries(colors)
    .map(
      ([state, color]) => `
    <div><i style="background:${color}"></i><span>${state}</span><b>${counts[state] || 0}</b></div>`,
    )
    .join("");
}

function orderRows(source) {
  return source
    .map(
      (order) => `
    <div class="admin-data-row">
      <strong>${clean(order.artworks?.title || "Artwork")}</strong>
      <span>${clean(order.buyer_email || "Email not supplied")}</span>
      <span class="status-pill ${clean(normalizedOrderState(order).toLowerCase())}">${clean(normalizedOrderState(order))}</span>
      <span>${money(order.amount)}</span>
    </div>`,
    )
    .join("");
}

function renderCustomers(customers) {
  document.querySelector("#admin-customers").innerHTML = customers.length
    ? `
    <div class="admin-data-row customer-row header"><span>Email</span><span>Orders</span><span>Images purchased</span><span>Total</span></div>
    ${customers.map((customer) => `<div class="admin-data-row customer-row"><strong>${clean(customer.email)}</strong><span>${customer.purchases.length}</span><span>${customer.purchases.map(clean).join(", ")}</span><span>${money(customer.total)}</span></div>`).join("")}`
    : "<p>No paid customer purchases yet.</p>";
}

function renderMessages() {
  const unread = messages.filter((message) => !message.is_read).length;
  const badge = document.querySelector("#message-badge");
  badge.hidden = unread === 0;
  badge.textContent = unread;
  document.querySelector("#dashboard-message-preview").innerHTML =
    messages
      .slice(0, 4)
      .map(
        (message) => `
    <div class="message-snippet"><div><strong>${clean(message.subject || "Customer message")}</strong><span>${clean(message.email)}</span></div><time>${shortDate(message.created_at)}</time></div>`,
      )
      .join("") || "<p>No customer messages yet.</p>";
  document.querySelector("#admin-messages").innerHTML =
    messages
      .map(
        (message) => `
    <article class="message-item ${message.is_read ? "" : "unread"}">
      <div class="message-meta"><strong>${clean(message.name)}</strong><a href="mailto:${encodeURIComponent(message.email)}">${clean(message.email)}</a><time>${new Date(message.created_at).toLocaleString()}</time></div>
      <h3>${clean(message.subject || "Customer message")}</h3><p>${clean(message.message)}</p>
      <p class="alert-status ${message.alert_sent_at ? "sent" : "failed"}">${
        message.alert_sent_at
          ? `Email alert sent ${clean(new Date(message.alert_sent_at).toLocaleString())}`
          : `Email alert not sent${message.alert_error ? `: ${clean(message.alert_error)}` : "."}`
      }</p>
      <div class="message-actions">
        <a class="button" href="mailto:${encodeURIComponent(message.email)}?subject=${encodeURIComponent(`Re: ${message.subject || "Your Pixel Shroom Studio message"}`)}">Reply by email</a>
        ${message.is_read ? "" : `<button type="button" class="secondary" data-message-read="${message.id}">Mark read</button>`}
        <button type="button" class="danger" data-message-delete="${message.id}" data-message-subject="${clean(message.subject || "Customer message")}">Delete message</button>
      </div>
    </article>`,
      )
      .join("") || "<p>No customer messages yet.</p>";
}

async function loadDashboard() {
  [articles, orders, messages] = await Promise.all([
    rowsFrom(supabase.from("articles").select("*").order("created_at", { ascending: false })),
    rowsFrom(
      supabase
        .from("orders")
        .select("*,artworks(title,category,serial_number)")
        .order("created_at", { ascending: false })
        .limit(250),
    ),
    rowsFrom(
      supabase
        .from("contact_messages")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(250),
    ),
  ]);
  const customers = customerRecords();
  renderStats("#stats", customers);
  renderStats("#analytics-stats", customers);
  renderSalesChart("#dashboard-sales-chart");
  renderSalesChart("#analytics-sales-chart");
  renderOrderStatus("#dashboard-status-donut", "#dashboard-status-legend");
  renderOrderStatus("#analytics-status-donut", "#analytics-status-legend");
  renderCustomers(customers);
  renderMessages();
  document.querySelector("#admin-recent-orders").innerHTML = orders.length
    ? `<div class="admin-data-row header"><span>Image</span><span>Customer</span><span>Status</span><span>Amount</span></div>${orderRows(orders.slice(0, 6))}`
    : "<p>No orders yet.</p>";
  document.querySelector("#admin-orders").innerHTML = orders.length
    ? `<div class="admin-data-row header"><span>Image</span><span>Customer</span><span>Status</span><span>Amount</span></div>${orderRows(orders)}`
    : "<p>No orders yet.</p>";
  document.querySelector("#admin-articles").innerHTML =
    articles
      .map(
        (article) =>
          `<div class="article-admin-row"><strong>${clean(article.title)}</strong><button data-article="${article.id}" data-next="${article.status === "published" ? "draft" : "published"}">${article.status === "published" ? "Unpublish" : "Publish"}</button></div>`,
      )
      .join("") || "<p>No articles yet.</p>";
}

async function showDashboard() {
  await requireAdmin();
  loginPanel.hidden = true;
  dashboard.hidden = false;
  await loadItems();
  await loadDashboard();
}

// SECTION: Finished tier images (no generated effects)
function updateTierUploadStatus() {
  for (const tier of FOIL_TIERS) {
    const input = artForm.elements.namedItem("tierImage" + tier);
    if (!input) continue;
    input.disabled = tierAssetsLocked;
    const saved = savedTierAssets.find((asset) => asset.tier === tier);
    document.querySelector("#tier-status-" + tier).textContent = saved
      ? `${saved.width} × ${saved.height} px saved${tierAssetsLocked ? " · locked" : ""}`
      : "No finished image uploaded";
  }
}
async function uploadTierImages(artworkId, serial, reuseStandard, values) {
  const assets = [];
  const previews = [];
  for (const tier of FOIL_TIERS) {
    if (reuseStandard && tier === "Standard") continue;
    const file = values.get("tierImage" + tier);
    if (!file?.size) continue;
    if (tierAssetsLocked) throw new Error("Tier images are locked for this edition.");
    const image = await readImage(file);
    const { width, height } = image;
    image.source.close();
    if (width * height > 100000000) throw new Error(`${tier}: maximum 100 million pixels.`);
    const sha256 = bytesToHex(
      new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())),
    );
    const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[file.type];
    const path = `foil-tiers/${artworkId}/${tier.toLowerCase()}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage
      .from("originals")
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw artworkUploadError(error, tier, "originals", file);
    assets.push({ tier, path, sha256, mimeType: file.type, width, height });
    const preview = await generatePreview(file, serial);
    const previewPath = `foil-tiers/${artworkId}/${tier.toLowerCase()}/${crypto.randomUUID()}.webp`;
    const { error: pe } = await supabase.storage
      .from("previews")
      .upload(previewPath, preview.blob, { contentType: "image/webp", upsert: false });
    if (pe) throw artworkUploadError(pe, tier + " preview", "previews", preview.blob);
    previews.push({ target: artworkId, chosen_tier: tier, preview: previewPath });
  }
  if (assets.length) {
    const { error } = await supabase.rpc("set_foil_tier_assets", {
      target_artwork: artworkId,
      assets,
    });
    if (error)
      throw new Error("Artwork saved, but tier images were not registered: " + error.message);
    for (const preview of previews) {
      const { error } = await supabase.rpc("set_foil_tier_preview", preview);
      if (error) throw error;
    }
  }
}

// SECTION: Artwork form state and automatic dimensions
function resetArtworkForm() {
  savedTierAssets = [];
  document.querySelector("#copy-inventory-status").textContent =
    "Copy hashes are prepared after the finished images are saved.";
  tierAssetsLocked = false;
  updateTierUploadStatus();
  delete artForm.dataset.foilConfigured;
  delete artForm.dataset.masterLocked;
  const savedSigningToken = sessionStorage.getItem("pixelShroomSigningToken") || "";
  editingArtworkId = null;
  artForm.reset();
  artForm.elements.artist.value = "LWVader";
  for (const name of [
    "foilSupply",
    "foilSilver",
    "foilGold",
    "foilEmerald",
    "foilSapphire",
    "foilPrismatic",
  ])
    artForm.elements.namedItem(name).readOnly = false;
  document.querySelector("#foil-odds-description").textContent = editionDisclosure({
    rulesVersion: 2,
    silverCap: 100,
    goldCap: 50,
    emeraldCap: 30,
    sapphireCap: 15,
    prismaticCap: 5,
  });
  artForm.elements.signingHelperToken.value = savedSigningToken;
  artForm.elements.displayWidth.value = 600;
  artForm.elements.displayHeight.value = 600;
  cancelEdit.hidden = true;
  document.querySelector("#art-form-title").textContent = "Add artwork or NFT";
  document.querySelector("#save-button").textContent = "Publish new listing";
  document.querySelector("#original-status").textContent =
    "Use a Standard file with its LWV serial in the image information or filename.";
  checkLocalSigner();
}

artForm.elements.tierImageStandard.addEventListener("change", async () => {
  const file = artForm.elements.tierImageStandard.files[0];
  const status = document.querySelector("#original-status");
  if (!file) {
    status.textContent = "No new Standard image selected.";
    return;
  }
  try {
    const image = await readImage(file);
    artForm.elements.displayWidth.value = Math.max(160, Math.min(960, image.width));
    artForm.elements.displayHeight.value = Math.max(120, Math.min(640, image.height));
    status.textContent = `Selected: ${file.name} · ${image.width} × ${image.height}px`;
    document.querySelector("#signature-status").textContent =
      "Ready to create C2PA, SHA-256, and studio signatures when you publish.";
    image.source.close();
  } catch (error) {
    status.textContent = error.message;
  }
});

// SECTION: Authentication
loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("#login-message", "Signing in…", true);
  const values = new FormData(loginForm);
  try {
    const { error } = await supabase.auth.signInWithPassword({
      email: values.get("email"),
      password: values.get("password"),
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
    const foilEnabled = values.get("foilEnabled") === "on";
    const foilIntent =
      values.get("category") !== "NFT" ||
      foilEnabled ||
      artForm.dataset.foilConfigured === "true" ||
      FOIL_TIERS.some(
        (tier) =>
          tier !== "Standard" && artForm.elements.namedItem("tierImage" + tier).files.length,
      );
    const publish = event.submitter?.value !== "draft";
    const foilSupply = Number(values.get("foilSupply"));
    const foilCaps = ["foilSilver", "foilGold", "foilEmerald", "foilSapphire", "foilPrismatic"].map(
      (name) => Number(values.get(name)),
    );
    if (
      foilEnabled &&
      (!Number.isInteger(foilSupply) ||
        foilSupply < 1 ||
        foilCaps.some((cap) => !Number.isInteger(cap) || cap < 0) ||
        foilCaps.reduce((a, b) => a + b, 0) > foilSupply)
    )
      throw new Error("Foil tier caps must be whole numbers and fit within maximum supply.");
    if (
      foilIntent &&
      publish &&
      FOIL_TIERS.some(
        (tier) =>
          !artForm.elements.namedItem("tierImage" + tier).files[0] &&
          !savedTierAssets.some((asset) => asset.tier === tier),
      )
    )
      throw new Error(
        "Upload the finished image for all six tiers before publishing this foil listing.",
      );
    const standard = values.get("tierImageStandard");
    const newStandard = standard instanceof File && standard.size > 0;
    if (newStandard && (tierAssetsLocked || artForm.dataset.masterLocked === "true"))
      throw Error("Tier images are locked for this edition.");
    const serial = newStandard ? await standardSerial(standard, values) : current?.serial_number;
    if (!serial) throw Error("Select the Standard image with its LWV serial.");
    if (current && serial !== current.serial_number)
      throw Error(
        "The Standard serial differs from this listing’s serial. Use the matching image.",
      );
    await checkArtworkSerial(serial, editingArtworkId);
    values.set("serialNumber", serial);
    const reductions = await prepareArtworkUploads(values, foilIntent);
    showMessage(
      "#form-message",
      reductions.length
        ? `Optimized ${reductions.join(", ")}. Signing and uploading…`
        : "Signing and uploading…",
      true,
    );
    const files = await uploadFiles(values, current);
    const row = {
      title: values.get("title").trim(),
      artist: values.get("artist").trim(),
      serial_number: serial,
      category: values.get("category"),
      price:
        editingArtworkId === null
          ? 8
          : (items.find((item) => item.id === editingArtworkId)?.price ?? 8),
      display_width: files.width,
      display_height: files.height,
      original_width: files.originalWidth,
      original_height: files.originalHeight,
      original_format: files.originalFormat,
      original_dimensions_source: files.dimensionsSource,
      status: foilIntent || !publish ? "draft" : current?.status || "published",
      requires_tier_images: Boolean(foilIntent),
      preview_url: files.previewUrl,
      original_path: files.originalPath,
      updated_at: new Date().toISOString(),
    };
    const wasEditing = Boolean(editingArtworkId);
    const artworkId = await saveArtwork(row, wasEditing ? editingArtworkId : null);
    // Preserve the private draft on partial upload failure so retry updates it.
    editingArtworkId = artworkId;
    if (!items.some((item) => item.id === artworkId)) items.push({ ...row, id: artworkId });
    if (files.signatureRecord) {
      await saveSignature(artworkId, files.signatureRecord);
    }
    if (
      foilIntent &&
      (newStandard ||
        foilEnabled ||
        artForm.dataset.foilConfigured === "true" ||
        FOIL_TIERS.some((tier) => values.get("tierImage" + tier)?.size))
    ) {
      const { error: foilError } = await supabase.rpc("configure_foil_listing_v2", {
        target_artwork: artworkId,
        active: foilEnabled,
        supply: foilSupply,
        silver: foilCaps[0],
        gold: foilCaps[1],
        emerald: foilCaps[2],
        sapphire: foilCaps[3],
        prismatic: foilCaps[4],
      });
      if (foilError)
        throw new Error("Artwork saved, but foil settings were not applied: " + foilError.message);
      if (newStandard) {
        const { error } = await supabase.rpc("set_standard_tier_from_master", {
          target_artwork: artworkId,
          preview: files.previewPath,
        });
        if (error) throw Error("Artwork saved, but Standard was not registered: " + error.message);
      }
    }
    if (foilIntent) await uploadTierImages(artworkId, serial, newStandard, values);
    if (foilIntent && publish) await saveRow("artworks", { status: "published" }, artworkId);
    delete artForm.dataset.foilConfigured;
    resetArtworkForm();
    showMessage(
      "#form-message",
      !publish
        ? "Private draft saved. This artwork has not been published."
        : foilIntent
          ? "Listing published. Authorized copy hashes are prepared in the background; checkout stays paused until preparation is complete."
          : files.signatureRecord
            ? `${wasEditing ? "Listing updated" : "Listing created"} and cryptographic identity registered.`
            : `${wasEditing ? "Listing updated" : "Listing created"}.`,
      true,
    );
    await loadItems();
    await loadDashboard();
  } catch (error) {
    showMessage(
      "#form-message",
      error.code === "23505" && error.message.includes("artworks_serial_number_key")
        ? "That serial already exists. Edit the existing artwork or preview the permanent reset for hidden records."
        : error.message,
    );
  } finally {
    button.disabled = false;
  }
});

adminCatalog.addEventListener("click", async (event) => {
  const edit = event.target.closest("[data-edit]");
  const toggle = event.target.closest("[data-toggle]");
  const remove = event.target.closest("[data-delete]");
  if (edit) {
    const item = items.find((entry) => entry.id === Number(edit.dataset.edit));
    editingArtworkId = item.id;
    const { data: foilSettings } = await supabase.rpc("admin_foil_settings", {
      target_artwork: item.id,
    });
    const { data: tierSettings, error: tierError } = await supabase.rpc("admin_foil_tier_assets", {
      target_artwork: item.id,
    });
    if (tierError) {
      showMessage(
        "#form-message",
        "Tier upload settings unavailable. Apply the uploaded-tier migration first.",
      );
      return;
    }
    savedTierAssets = tierSettings?.assets || [];
    document.querySelector("#copy-inventory-status").textContent =
      `Copy hashes prepared: ${tierSettings?.prepared || 0}/${tierSettings?.authorized || 0}. Checkout opens when preparation is complete.`;
    tierAssetsLocked = Boolean(tierSettings?.locked);
    for (const tier of FOIL_TIERS) artForm.elements.namedItem("tierImage" + tier).value = "";
    updateTierUploadStatus();
    artForm.dataset.foilConfigured = foilSettings ? "true" : "false";
    artForm.dataset.masterLocked = String(Boolean(foilSettings?.locked));
    artForm.elements.namedItem("foilEnabled").checked = Boolean(foilSettings?.enabled);
    for (const [name, key, fallback] of [
      ["foilSupply", "maxSupply", 500],
      ["foilSilver", "silverCap", 100],
      ["foilGold", "goldCap", 50],
      ["foilEmerald", "emeraldCap", 30],
      ["foilSapphire", "sapphireCap", 15],
      ["foilPrismatic", "prismaticCap", 5],
    ])
      artForm.elements.namedItem(name).value = foilSettings?.[key] ?? fallback;
    for (const name of [
      "foilSupply",
      "foilSilver",
      "foilGold",
      "foilEmerald",
      "foilSapphire",
      "foilPrismatic",
    ])
      artForm.elements.namedItem(name).readOnly = Boolean(foilSettings?.locked);
    const displayedFoilSettings = foilSettings
      ? foilSettings.locked
        ? foilSettings
        : { ...foilSettings, rulesVersion: 2, dropRates: SIX_TIER_RATES }
      : {
          rulesVersion: 2,
          silverCap: 100,
          goldCap: 50,
          emeraldCap: 30,
          sapphireCap: 15,
          prismaticCap: 5,
        };
    document.querySelector("#foil-odds-description").textContent =
      (foilSettings?.locked
        ? "Locked edition: "
        : "Saving an unreserved draft uses six-tier rules. ") +
      editionDisclosure(displayedFoilSettings);
    const values = {
      title: item.title,
      artist: item.artist || "LWVader",
      category: item.category,
      displayWidth: item.display_width,
      displayHeight: item.display_height,
    };
    Object.entries(values).forEach(([name, value]) => {
      artForm.elements.namedItem(name).value = value;
    });
    document.querySelector("#original-status").textContent = `Saved serial: ${item.serial_number}`;
    document.querySelector("#art-form-title").textContent = `Editing: ${item.title}`;
    document.querySelector("#save-button").textContent = "Save listing changes";
    cancelEdit.hidden = false;
    artForm.scrollIntoView({ behavior: "smooth" });
  }
  if (toggle) {
    const item = items.find((entry) => entry.id === Number(toggle.dataset.toggle));
    toggle.disabled = true;
    try {
      if (item.status !== "published" && item.requires_tier_images) {
        const { data, error } = await supabase.rpc("admin_foil_tier_assets", {
          target_artwork: item.id,
        });
        if (error) throw error;
        if (data?.assets?.length !== 6)
          throw new Error(
            "All six tier images are required before publishing. Edit this private draft to upload the missing images.",
          );
      }
      await saveRow(
        "artworks",
        { status: item.status === "published" ? "archived" : "published" },
        item.id,
      );
      await loadItems();
      await loadDashboard();
    } catch (error) {
      showMessage("#form-message", error.message);
    } finally {
      toggle.disabled = false;
    }
  }
  if (remove) {
    const item = items.find((entry) => entry.id === Number(remove.dataset.delete));
    if (!item) return;
    const confirmed = window.confirm(
      `Delete "${item.title}" from the site?\n\n` +
        "The listing will disappear from the storefront and Current images. " +
        "Supabase history, orders, signatures, and stored files will be preserved.",
    );
    if (!confirmed) return;
    try {
      await requireAdmin();
      await saveRow(
        "artworks",
        {
          status: "archived",
          deleted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        item.id,
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
document.querySelector("#new-listing-button").addEventListener("click", () => {
  resetArtworkForm();
  artForm.scrollIntoView({ behavior: "smooth" });
});

// SECTION: Editorial controls
document.querySelector("#article-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector('button[type="submit"]');
  const values = Object.fromEntries(new FormData(form));

  submitButton.disabled = true;
  showMessage("#article-message", "Publishing article…", true);

  try {
    await requireAdmin();
    await saveRow("articles", {
      title: values.title.trim(),
      excerpt: values.excerpt.trim(),
      body: values.body.trim(),
      status: "published",
    });
    form.reset();
    showMessage("#article-message", "Article published successfully.", true);
    await loadDashboard();
  } catch (error) {
    console.error("Article publish failed:", error);
    showMessage("#article-message", error.message || "The article could not be published.", false);
  } finally {
    submitButton.disabled = false;
  }
});
document.querySelector("#admin-articles").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-article]");
  if (!button) return;

  button.disabled = true;

  try {
    await requireAdmin();
    await saveRow("articles", { status: button.dataset.next }, button.dataset.article);
    showMessage(
      "#article-message",
      button.dataset.next === "published" ? "Article published." : "Article unpublished.",
      true,
    );
    await loadDashboard();
  } catch (error) {
    console.error("Article status update failed:", error);
    showMessage(
      "#article-message",
      error.message || "The article status could not be changed.",
      false,
    );
    button.disabled = false;
  }
});

// SECTION: Dashboard section navigation
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
      body: { email: new FormData(form).get("email").trim().toLowerCase() },
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
  const readButton = event.target.closest("[data-message-read]");
  const deleteButton = event.target.closest("[data-message-delete]");

  if (readButton) {
    readButton.disabled = true;
    const { error } = await supabase
      .from("contact_messages")
      .update({ is_read: true })
      .eq("id", readButton.dataset.messageRead);
    if (error) {
      readButton.disabled = false;
      return alert(error.message);
    }
    await loadDashboard();
    return;
  }

  if (deleteButton) {
    const subject = deleteButton.dataset.messageSubject || "this message";
    if (!confirm(`Permanently delete “${subject}”?`)) return;

    deleteButton.disabled = true;
    const { error } = await supabase
      .from("contact_messages")
      .delete()
      .eq("id", deleteButton.dataset.messageDelete);
    if (error) {
      deleteButton.disabled = false;
      return alert(error.message);
    }
    await loadDashboard();
  }
});

// SECTION: Session and password controls
document.querySelector("#logout-button").addEventListener("click", async () => {
  await supabase.auth.signOut();
  location.reload();
});
const dialog = document.querySelector("#password-dialog");
document
  .querySelector("#change-password-button")
  .addEventListener("click", () => dialog.showModal());
document.querySelector("#close-password").addEventListener("click", () => dialog.close());
document.querySelector("#password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const { error } = await supabase.auth.updateUser({
      password: new FormData(event.currentTarget).get("newPassword"),
    });
    if (error) throw error;
    await supabase.auth.signOut();
    location.reload();
  } catch (error) {
    showMessage("#password-message", error.message);
  }
});

// SECTION: Restore an existing authenticated session
showDashboard().catch(async () => {
  await supabase.auth.signOut();
  loginPanel.hidden = false;
  dashboard.hidden = true;
});

artForm.elements.signingHelperToken.value = sessionStorage.getItem("pixelShroomSigningToken") || "";
document.querySelector("#check-signing-helper").addEventListener("click", checkLocalSigner);
document.querySelector("#dashboard-date").textContent = new Date().toLocaleDateString([], {
  month: "long",
  day: "numeric",
  year: "numeric",
});
const requestedView = location.hash.slice(1);
if (document.getElementById(requestedView)?.classList.contains("admin-view"))
  openAdminView(requestedView);

// Regenerate public previews for existing locked sources without replacing signed files.
document.querySelector("#prepare-tier-previews")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await requireAdmin();
    if (!editingArtworkId || savedTierAssets.length !== 6)
      throw Error("Open an existing collection with all six saved tier images first.");
    for (const asset of savedTierAssets) {
      const { data, error } = await supabase.storage.from("originals").download(asset.path);
      if (error) throw error;
      const file = new File([data], "tier-image", { type: asset.mimeType });
      const preview = await generatePreview(
        file,
        items.find((item) => item.id === editingArtworkId).serial_number,
      );
      const path = `foil-tiers/${editingArtworkId}/${asset.tier.toLowerCase()}/${crypto.randomUUID()}.webp`;
      const upload = await supabase.storage
        .from("previews")
        .upload(path, preview.blob, { contentType: "image/webp", upsert: false });
      if (upload.error) throw upload.error;
      const saved = await supabase.rpc("set_foil_tier_preview", {
        target: editingArtworkId,
        chosen_tier: asset.tier,
        preview: path,
      });
      if (saved.error) throw saved.error;
    }
    showMessage(
      "#form-message",
      "Six protected previews prepared. Private tier sources and issued file hashes are unchanged.",
      true,
    );
  } catch (error) {
    showMessage("#form-message", error.message);
  } finally {
    button.disabled = false;
  }
});

// SECTION: Preview and explicitly confirm a clean start for the test storefront.
const resetStatus = document.querySelector("#storefront-reset-status");
const resetCounts = document.querySelector("#storefront-reset-counts");
const previewReset = document.querySelector("#preview-storefront-reset");
const applyReset = document.querySelector("#apply-storefront-reset");
const resetPhrase = "RESET TEST STOREFRONT";
let reviewedResetCounts;

function resetErrorMessage(error) {
  if (error.code === "PGRST202") {
    return "The reset is not installed in this Supabase project. Apply the pending migrations with supabase db push, then reload this page.";
  }
  return error.message;
}

previewReset.addEventListener("click", async () => {
  previewReset.disabled = true;
  applyReset.hidden = true;
  reviewedResetCounts = null;
  resetCounts.hidden = true;
  resetCounts.replaceChildren();
  resetStatus.textContent = "Counting records…";
  try {
    await requireAdmin();
    const { data, error } = await supabase.rpc("preview_storefront_reset");
    if (error) throw error;
    reviewedResetCounts = data;
    const entries = Object.entries(data).filter(([, count]) => count > 0);
    for (const [table, count] of entries) {
      const li = document.createElement("li");
      li.textContent = `${table.replaceAll("_", " ")}: ${count}`;
      resetCounts.append(li);
    }
    resetCounts.hidden = !entries.length;
    applyReset.hidden = !entries.length;
    resetStatus.textContent = entries.length
      ? "Review these counts before permanently clearing the test records."
      : "No storefront records to clear. Check Supabase Storage separately for old uploads.";
  } catch (error) {
    resetStatus.textContent = resetErrorMessage(error);
  } finally {
    previewReset.disabled = false;
  }
});

applyReset.addEventListener("click", async () => {
  if (!reviewedResetCounts) return;
  const confirmation = prompt(
    `This permanently clears the reviewed test records. Type ${resetPhrase} to continue.`,
  );
  if (confirmation !== resetPhrase) return;
  applyReset.disabled = true;
  previewReset.disabled = true;
  try {
    await requireAdmin();
    const { error } = await supabase.rpc("reset_test_storefront", {
      expected_counts: reviewedResetCounts,
      confirmation,
    });
    if (error) throw error;
    resetArtworkForm();
    resetStatus.textContent =
      "Test storefront cleared. Artwork serials can be reused. Empty the old files in Supabase Storage before uploading again.";
    await Promise.allSettled([loadItems(), loadDashboard()]);
  } catch (error) {
    resetStatus.textContent = resetErrorMessage(error);
  } finally {
    reviewedResetCounts = null;
    resetCounts.hidden = true;
    applyReset.hidden = true;
    applyReset.disabled = false;
    previewReset.disabled = false;
  }
});
