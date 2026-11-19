import {supabase} from "./supabase-client.js";
import {alreadyUploaded, campaignZipPath, checkZipFile} from "./campaign-zip.mjs";

const $ = (id) => document.getElementById(id);
const login = $("sign-in");
const orders = $("orders");
const list = $("order-list");
const panel = $("order-detail");
const publish = $("publish-zip");
const status = $("detail-status");
const pageSize = 25;
const offers = {attention: "Attention Pack", monthly: "Monthly Asset Pack"};
const date = new Intl.DateTimeFormat(undefined, {dateStyle: "medium", timeStyle: "short"});
let authorized = false;
let rows = [];
let selected = null;
let more = false;
let generation = 0;
let busy = false;

function button(label, action) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "secondary";
  element.textContent = label;
  element.addEventListener("click", action);
  return element;
}

function row(title, description, action) {
  const element = document.createElement("li");
  element.className = "order-row";
  const info = document.createElement("div");
  const heading = document.createElement("strong");
  const sub = document.createElement("small");
  heading.textContent = title;
  sub.textContent = description;
  info.append(heading, sub);
  element.append(info, action);
  return element;
}

function renderOrders() {
  const query = $("order-search").value.trim().toLowerCase();
  const shown = rows.filter((order) =>
    [order.business, order.industry, order.buyer_email].some((field) => field.toLowerCase().includes(query)));
  list.replaceChildren(...shown.map((order) => {
    const count = order.campaign_zip_deliveries.length;
    const delivery = count ? `${count} ZIP${count === 1 ? "" : "s"} published` : "Awaiting ZIP";
    return row(order.business,
      `${offers[order.offer]} · ${order.buyer_email} · ${delivery}`,
      button("Open brief", () => openOrder(order)));
  }));
  $("more-orders").hidden = !more;
  $("order-status").textContent = shown.length
    ? `${shown.length} loaded ${shown.length === 1 ? "brief" : "briefs"} shown.`
    : query ? "No loaded briefs match this search." : "No campaign briefs have been submitted.";
}

async function loadOrders(reset = false) {
  if (!authorized) return;
  const request = ++generation;
  const offset = reset ? 0 : rows.length;
  const refresh = $("refresh");
  const moreButton = $("more-orders");
  refresh.disabled = moreButton.disabled = true;
  $("order-status").textContent = "Loading briefs…";
  try {
    const {data, error} = await supabase.from("campaign_briefs")
      .select("checkout_session_id,offer,buyer_email,business,industry,vibe,colors,goal,created_at,landing_paid_at,campaign_zip_deliveries(id,file_name,published_at)")
      .order("created_at", {ascending: false})
      .order("checkout_session_id")
      .range(offset, offset + pageSize);
    if (request !== generation || !authorized) return;
    if (error) throw error;
    const page = data.slice(0, pageSize);
    more = data.length > pageSize;
    rows = reset ? page : rows.concat(page.filter((order) => !rows.some((existing) =>
      existing.checkout_session_id === order.checkout_session_id)));
    renderOrders();
  } catch {
    if (request === generation) $("order-status").textContent = "Briefs could not be loaded. Try refreshing.";
  } finally {
    if (request === generation) refresh.disabled = moreButton.disabled = false;
  }
}

function openOrder(order) {
  selected = order;
  $("detail-title").textContent = order.business;
  $("detail-offer").textContent = offers[order.offer];
  const fields = [
    ["Buyer email", order.buyer_email], ["Industry", order.industry], ["Vibe", order.vibe],
    ["Colors", order.colors || "No preference"], ["Campaign goal", order.goal],
    ["Received", date.format(new Date(order.created_at))]
  ];
  if (order.landing_paid_at) fields.push(["Landing page", "Paid"]);
  $("brief-details").replaceChildren(...fields.flatMap(([label, value]) => {
    const key = document.createElement("dt");
    const info = document.createElement("dd");
    key.textContent = label;
    info.textContent = value;
    return [key, info];
  }));
  publish.reset();
  status.textContent = "";
  renderFiles(order);
  panel.showModal();
}

function renderFiles(order) {
  const files = [...order.campaign_zip_deliveries].sort((a, b) => b.published_at.localeCompare(a.published_at));
  $("file-help").textContent = order.offer === "monthly"
    ? "Confirm the matching monthly invoice in Stripe before publishing each ZIP."
    : "Publish the finished ZIP to make it available on the buyer’s order page.";
  $("file-list").replaceChildren(...files.map((file) =>
    row(file.file_name, date.format(new Date(file.published_at)), button("Withdraw", () => withdraw(order, file)))));
}

function setBusy(active) {
  busy = active;
  for (const control of panel.querySelectorAll("form input, form button, #file-list button")) {
    control.disabled = active;
  }
}

async function refreshFiles(order) {
  const {data, error} = await supabase.from("campaign_zip_deliveries")
    .select("id,file_name,published_at").eq("checkout_session_id", order.checkout_session_id);
  if (error) throw error;
  if (!authorized) return;
  order.campaign_zip_deliveries = data;
  rows = rows.map((brief) => brief.checkout_session_id === order.checkout_session_id ? order : brief);
  renderOrders();
  if (selected === order) renderFiles(order);
}

async function withdraw(order, file) {
  if (!authorized || busy || !window.confirm(`Withdraw ${file.file_name} from this buyer’s order page?`)) return;
  setBusy(true);
  try {
    const {error} = await supabase.rpc("withdraw_campaign_zip_as_admin", {
      order_session: order.checkout_session_id, delivery_id: file.id
    });
    if (error) throw error;
    status.textContent = "ZIP withdrawn. Previously issued download links may still work for up to two minutes.";
    await refreshFiles(order).catch(() => { status.textContent += " Refresh to update this list."; });
  } catch {
    status.textContent = "The ZIP could not be withdrawn. Try again.";
  } finally {
    setBusy(false);
  }
}

publish.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!authorized || busy || !selected) return;
  const order = selected;
  const file = publish.elements.archive.files[0];
  if (!file) return;
  setBusy(true);
  try {
    checkZipFile(file.name, file.size);
    status.textContent = "Preparing ZIP…";
    const path = await campaignZipPath(order.checkout_session_id, file.name, new Uint8Array(await file.arrayBuffer()));
    status.textContent = "Uploading ZIP…";
    const {error: uploadError} = await supabase.storage.from("campaign-zips")
      .upload(path, file, {contentType: "application/zip", upsert: false});
    if (uploadError && !alreadyUploaded(uploadError)) {
      throw new Error("Upload failed. Check the project’s Storage limit and try again.");
    }
    const {error} = await supabase.rpc("publish_campaign_zip_as_admin", {
      order_session: order.checkout_session_id, zip_path: path
    });
    if (error) throw new Error("The ZIP could not be linked to this order. Try publishing the same file again.");
    publish.reset();
    status.textContent = "ZIP published. The buyer can download it from their order page.";
    await refreshFiles(order).catch(() => { status.textContent += " Refresh to update this list."; });
  } catch (error) {
    status.textContent = error.message;
  } finally {
    setBusy(false);
  }
});

$("copy-order-page").addEventListener("click", async () => {
  if (!authorized || !selected) return;
  const url = new URL("/brief.html", location.origin);
  url.searchParams.set("session_id", selected.checkout_session_id);
  try {
    await navigator.clipboard.writeText(url.href);
    status.textContent = "Private order link copied. Send it to the buyer at their checkout email.";
  } catch {
    status.textContent = url.href;
  }
});

function clearOrders() {
  generation++;
  authorized = false;
  rows = [];
  selected = null;
  more = false;
  orders.hidden = $("admin-actions").hidden = true;
  list.replaceChildren();
  $("file-list").replaceChildren();
  $("brief-details").replaceChildren();
  $("detail-title").textContent = "";
  $("detail-offer").textContent = "";
  $("order-search").value = "";
  status.textContent = "";
  publish.reset();
  if (panel.open) panel.close();
}

async function openWorkspace(session) {
  clearOrders();
  login.hidden = Boolean(session);
  $("sign-out").hidden = !session;
  $("access-status").textContent = session ? "Verifying administrator access…" : "";
  if (!session) return;
  const check = generation;
  const {data, error} = await supabase.rpc("is_admin");
  if (check !== generation) return;
  authorized = !error && data === true;
  if (!authorized) {
    $("access-status").textContent = error ? "Could not verify access. Sign out and try again." : "This account does not have administrator access.";
    return;
  }
  $("access-status").textContent = "";
  orders.hidden = $("admin-actions").hidden = false;
  await loadOrders(true);
}

login.addEventListener("submit", async (event) => {
  event.preventDefault();
  event.submitter.disabled = true;
  try {
    const {data, error} = await supabase.auth.signInWithPassword({
      email: login.elements.email.value.trim(),
      password: login.elements.password.value
    });
    if (error) throw error;
    login.reset();
    await openWorkspace(data.session);
  } catch {
    $("access-status").textContent = "Sign-in failed. Check your email and password and try again.";
  } finally {
    event.submitter.disabled = false;
  }
});

$("sign-out").addEventListener("click", async () => {
  const {error} = await supabase.auth.signOut({scope: "local"});
  if (error) $("access-status").textContent = "Could not sign out. Try again.";
  else await openWorkspace(null);
});
$("order-search").addEventListener("input", renderOrders);
$("refresh").addEventListener("click", () => loadOrders(true));
$("more-orders").addEventListener("click", () => loadOrders());
$("close-order").addEventListener("click", () => { if (!busy) panel.close(); });
panel.addEventListener("cancel", (event) => { if (busy) event.preventDefault(); });
panel.addEventListener("close", () => { selected = null; });

if (supabase) {
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") void openWorkspace(null);
  });
  try {
    const {data: {session}} = await supabase.auth.getSession();
    await openWorkspace(session);
  } catch {
    $("access-status").textContent = "Could not load your session. Refresh and try again.";
  }
} else {
  $("access-status").textContent = "Set the Supabase project and public key in the Worker to enable admin sign-in.";
}
