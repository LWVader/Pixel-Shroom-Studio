import {loadPortfolio} from "./campaign-publisher.js";

const $ = (id) => document.getElementById(id);
const orders = $("orders");
const list = $("order-list");
const panel = $("order-detail");
const markSent = $("mark-email-sent");
const status = $("detail-status");
const deliverySender = "weirichloren@gmail.com";
const offers = {attention: "Attention Pack", monthly: "Monthly Asset Pack"};
const date = new Intl.DateTimeFormat(undefined, {dateStyle: "medium", timeStyle: "short"});
let rows = [];
let selected = null;
let more = false;
let nextOffset = 0;
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

const stages = {
  new: ["New order", "#bca1ff"], production: ["In production", "#ec9bff"],
  ready: ["Ready to email", "#f5c177"], delivered: ["Delivered", "#d9ff55"]
};

function renderWorkflow(counts, activity) {
  const total = Object.keys(stages).reduce((sum, key) => sum + (counts[key] || 0), 0);
  $("workflow-total").textContent = `${total} total ${total === 1 ? "order" : "orders"}`;
  const segments = [], stats = [];
  for (const [key, [label, color]] of Object.entries(stages)) {
    const count = counts[key] || 0;
    const segment = document.createElement("span");
    segment.style.backgroundColor = color;
    segment.style.width = total ? (100 * count / total) + "%" : "0%";
    segments.push(segment);
    const stat = document.createElement("div");
    stat.className = "workflow-stat";
    const value = document.createElement("strong");
    value.textContent = count;
    value.style.color = color;
    const title = document.createElement("span");
    title.textContent = label;
    stat.append(value, title);
    stats.push(stat);
  }
  $("workflow-bar").replaceChildren(...segments);
  $("workflow-counts").replaceChildren(...stats);
  $("workflow-activity").replaceChildren(...activity.map((entry) => {
    const item = document.createElement("li");
    item.textContent = `${entry.business} · ${stages[entry.fulfillment_stage][0]} · ${date.format(new Date(entry.activity_at))}`;
    return item;
  }));
  $("workflow-activity").hidden = !activity.length;
  document.querySelector(".activity-heading").hidden = !activity.length;
}

function renderOrders() {
  const query = $("order-search").value.trim().toLowerCase();
  const shown = rows.filter((order) =>
    [order.business, order.industry, order.buyer_email].some((field) => field.toLowerCase().includes(query)));
  list.replaceChildren(...shown.map((order) => {
    const delivery = stages[order.fulfillment_stage]?.[0] || "New order";
    return row(order.business,
      `${offers[order.offer]} · ${order.buyer_email} · ${delivery}`,
      button(order.offer === "monthly" ? "Open order" : "Open brief", () => openOrder(order)));
  }));
  $("more-orders").hidden = !more;
  $("order-status").textContent = shown.length
    ? `${shown.length} loaded ${shown.length === 1 ? "order" : "orders"} shown.`
    : query ? "No loaded orders match this search." : "No orders or campaign briefs have been received.";
}

async function api(path, method = "GET", body) {
  const options = method === "GET" ? {} : {
    method, headers: {"Content-Type": "application/json"}, body: JSON.stringify(body ?? {})
  };
  const response = await fetch(path, options);
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Could not reach Campaign Admin.");
  return data;
}

function adminApi(query = "", body) {
  return api("/api/admin/campaigns" + query, body ? "POST" : "GET", body);
}

async function loadOrders(reset = false) {
  const request = ++generation;
  const offset = reset ? 0 : nextOffset;
  const refresh = $("refresh");
  const moreButton = $("more-orders");
  refresh.disabled = moreButton.disabled = true;
  $("order-status").textContent = "Loading orders…";
  try {
    const {orders: page, more: hasNext, counts, activity} = await adminApi(`?offset=${offset}`);
    if (request !== generation) return;
    more = hasNext;
    nextOffset = offset + page.length;
    rows = reset ? page : rows.concat(page.filter((order) => !rows.some((existing) =>
      existing.checkout_session_id === order.checkout_session_id)));
    renderOrders();
    renderWorkflow(counts || {}, activity || []);
  } catch {
    if (request === generation) $("order-status").textContent = "Orders could not be loaded. Try refreshing.";
  } finally {
    if (request === generation) refresh.disabled = moreButton.disabled = false;
  }
}

function openOrder(order) {
  selected = order;
  $("detail-title").textContent = order.business;
  $("detail-offer").textContent = offers[order.offer];
  const fields = order.offer === "monthly" ? [
    ["Buyer email", order.buyer_email],
    ["Delivery", "10 independent, randomly themed backgrounds per month"],
    ["Creative brief", "Not required"],
    ["Received", date.format(new Date(order.created_at))]
  ] : [
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
  status.textContent = "";
  renderDelivery(order);
  renderStage(order);
  panel.showModal();
}

function renderDelivery(order) {
  const deliveryInstruction = `In Gmail, check that the From address is ${deliverySender} and attach the finished ZIP before sending.`;
  $("delivery-help").textContent = order.offer === "monthly"
    ? `Use the Monthly Asset Pack delivery panel for automatic sends. Only use this manual fallback after checking the invoice and delivery log to avoid duplicate delivery. ${deliveryInstruction}`
    : deliveryInstruction;
  $("delivery-state").textContent = order.email_delivered_at
    ? `Last email recorded as sent ${date.format(new Date(order.email_delivered_at))}.`
    : "No delivery email recorded yet.";
  markSent.textContent = order.email_delivered_at ? "Record another send" : "Mark email sent";

  const draft = new URL(`https://mail.google.com/mail/u/${encodeURIComponent(deliverySender)}/`);
  draft.search = new URLSearchParams({
    view: "cm",
    fs: "1",
    tf: "cm",
    to: order.buyer_email,
    su: `Pixel Shroom Studio | Your ${offers[order.offer]}`,
    body: order.offer === "monthly" ? "Hi,\r\n\r\nYour Monthly Asset Pack ZIP with 10 fresh backgrounds is attached.\r\n\r\nThanks,\r\nLoren\r\nPixel Shroom Studio" : "Hi,\r\n\r\nYour finished campaign ZIP is attached.\r\n\r\nThanks,\r\nLoren\r\nPixel Shroom Studio"
  }).toString();
  $("compose-email").href = draft.href;
}

function renderStage(order) {
  $("production-stage").value = order.fulfillment_stage || "new";
  $("stage-form").hidden = order.fulfillment_stage === "delivered" && order.offer !== "monthly";
}

$("stage-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || !selected) return;
  const order = selected;
  const stage = $("production-stage").value;
  if (stage === "delivered") return;
  busy = event.submitter.disabled = true;
  try {
    const result = await adminApi("", {action: "set-stage", sessionId: order.checkout_session_id, stage});
    Object.assign(order, result);
    renderStage(order);
    status.textContent = "Production stage updated.";
    await loadOrders(true);
  } catch (error) {
    status.textContent = error.message;
  } finally {
    busy = event.submitter.disabled = false;
  }
});

markSent.addEventListener("click", async () => {
  if (busy || !selected || !window.confirm("Have you sent the email with the ZIP attached?")) return;
  const order = selected;
  busy = markSent.disabled = true;
  try {
    const result = await adminApi("", {
      sessionId: order.checkout_session_id,
      previous: order.email_delivered_at ?? null
    });
    if (!result.email_delivered_at) throw new Error("The sent status could not be saved.");
    if (selected !== order) return;
    Object.assign(order, result);
    renderStage(order);
    renderDelivery(order);
    status.textContent = "Email marked as sent.";
    await loadOrders(true);
  } catch {
    if (selected === order) status.textContent = "The sent status could not be saved. Try again.";
  } finally {
    busy = markSent.disabled = false;
  }
});

$("order-search").addEventListener("input", renderOrders);
$("refresh").addEventListener("click", () => loadOrders(true));
$("more-orders").addEventListener("click", () => loadOrders());
$("close-order").addEventListener("click", () => { if (!busy) panel.close(); });
panel.addEventListener("cancel", (event) => { if (busy) event.preventDefault(); });
panel.addEventListener("close", () => { selected = null; });

const monthlyPanel = $("monthly-delivery-panel");
const monthlyForm = $("monthly-upload-form");
const monthlyConfig = $("monthly-configuration");
monthlyForm.elements.month.value = new Date().toISOString().slice(0,7);

function monthlyItem(text) {
  const item = document.createElement("li");
  item.className = "order-row";
  const title = document.createElement("span");
  title.textContent = text;
  item.append(title);
  return item;
}

let monthlyBusy=false, storageReady=false, databaseReady=false, monthlyInventory=null;
const zipInput=monthlyForm.elements.zip;
const publishButton=monthlyForm.querySelector('button[type="submit"]');
const registerButton=$("register-monthly-zip");
const maxZip=25*1024*1024;
monthlyForm.elements.month.addEventListener("change",syncMonthlyButtons);
monthlyForm.elements.month.addEventListener("input",syncMonthlyButtons);
function syncMonthlyButtons(){
  const month=monthlyForm.elements.month.value;
  const entry=monthlyInventory?.ok?monthlyInventory.files.find(file=>file.month===month):null;
  const known=monthlyInventory?.ok && !monthlyInventory.partial;
  const missing=monthlyInventory?.missing?.includes(month+".zip");
  publishButton.disabled=monthlyBusy || !storageReady || !databaseReady || entry?.status==="published" || Boolean(missing);
  registerButton.disabled=monthlyBusy || !storageReady || !databaseReady || (known && entry?.status!=="unregistered");
  const help=$("monthly-recovery-help");
  if(!storageReady)help.textContent="Recovery is unavailable until the private Supabase bucket connects.";
  else if(!databaseReady)help.textContent="Storage is connected, but ZIP registration is unavailable until the Cloudflare delivery database is ready.";
  else if(entry?.status==="unregistered")help.textContent=`${entry.name} exists in Supabase but is not published. Use Register existing ZIP to validate and register it.`;
  else if(missing)help.textContent=`A published record exists for ${month}, but its ZIP is missing in Storage. Restore the original ZIP in Supabase; do not replace a published pack with different artwork.`;
  else if(entry?.status==="published")help.textContent=`${entry.name} is already published. No recovery is needed.`;
  else if(known)help.textContent=`No stored ZIP for ${month||"the selected month"}. Choose your local ZIP and use Publish monthly ZIP.`;
  else help.textContent="Storage inventory is unavailable or incomplete. Register existing ZIP only if the intended YYYY-MM.zip is already in the private bucket.";
}
zipInput.addEventListener("change",()=>{
  const file=zipInput.files[0];
  $("monthly-file-selection").textContent=file
    ? `Selected: ${file.name} · ${(file.size/1048576).toFixed(2)} MiB${file.size>maxZip?" — exceeds 25 MiB": " — ready to publish"}`
    : "Choose a Windows ZIP with 10 images.";
});
async function loadMonthly() {
  $("monthly-inventory-status").textContent="Checking the private monthly-asset-packs bucket…";
  try {
    const {config,packs,deliveries,counts,storageCheck,inventory,databaseCheck} = await api("/api/admin/monthly-delivery");
    storageReady=Boolean(storageCheck?.ok);
    databaseReady=Boolean(databaseCheck?.ok);
    monthlyInventory=inventory||null;
    monthlyConfig.textContent = `Supabase: ${storageReady?"connected":"not connected"} · Delivery database: ${databaseReady?"ready":"not ready"} · Stripe webhook: ${config.stripe ? "configured" : "not configured"} · Email: ${config.email ? "configured" : "not configured"} · Auto-delivery: ${config.enabled && storageReady && databaseReady && config.stripe && config.email ? "enabled" : "disabled"}. ${storageCheck?.message||""} ${databaseCheck?.message||""}`;
    const storageList=$("monthly-storage-files");
    if(inventory?.ok){
      $("monthly-inventory-status").textContent=`Private bucket: monthly-asset-packs · ${inventory.files.length} item(s) found${inventory.partial?" (first 100 only)":""}. No files are modified by this check.`;
      const items=inventory.files.map(file=>monthlyItem(`${file.name}${file.bytes===null?"":` · ${(file.bytes/1048576).toFixed(2)} MiB`} · ${file.status==="published"?"Published":file.status==="unregistered"?"Stored, not registered":file.status==="unknown"?"Stored; registration status unknown":"Not a monthly YYYY-MM.zip"}`));
      items.push(...inventory.missing.map(name=>monthlyItem(`${name} · Published record exists but file is missing in Storage`)));
      storageList.replaceChildren(...(items.length?items:[monthlyItem("The private bucket is empty. Publish a ZIP from your computer.")]));
    }else{
      $("monthly-inventory-status").textContent=inventory?.message||"Storage inventory unavailable.";
      storageList.replaceChildren();
    }
    $("monthly-packs").replaceChildren(...(packs.length ? packs.map(p => monthlyItem(`${p.pack_month} · ${(p.byte_size/1048576).toFixed(2)} MiB · Published`)) : [monthlyItem("No monthly ZIPs published yet.")]));
    $("monthly-counts").textContent = counts.length ? counts.map(c => `${c.state}: ${c.count}`).join(" · ") : "No queued deliveries.";
    $("monthly-deliveries").replaceChildren(...deliveries.map(d => monthlyItem(`${d.pack_month} · ${d.buyer_email} · ${d.state}${d.last_error ? " · "+d.last_error : ""}`)));
  } catch(error) {
    storageReady=false;
    databaseReady=false;
    monthlyInventory=null;
    $("monthly-inventory-status").textContent="Storage check failed: "+error.message;
    $("monthly-storage-files").replaceChildren();
    monthlyConfig.textContent = "Delivery status unavailable. " + error.message;
  } finally {syncMonthlyButtons();}
}
$("refresh-monthly").addEventListener("click",loadMonthly);
function uploadZip(file,month,status){
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();
    xhr.open("POST","/api/admin/monthly-delivery");
    xhr.setRequestHeader("Content-Type","application/zip");
    xhr.setRequestHeader("X-Pack-Month",month);
    xhr.timeout=180000;
    xhr.upload.onprogress=event=>{
      if(event.lengthComputable)status.textContent=`Uploading ZIP: ${Math.round(100*event.loaded/event.total)}%`;
    };
    xhr.upload.onload=()=>{status.textContent="ZIP received. Validating and registering with private storage…";};
    xhr.onload=()=>{
      let result;
      try{result=JSON.parse(xhr.responseText);}catch{}
      if(xhr.status>=200&&xhr.status<300&&result?.month)resolve(result);
      else reject(new Error(result?.error || `Upload failed (HTTP ${xhr.status}). Refresh delivery status and retry.`));
    };
    xhr.onerror=()=>reject(new Error("Connection interrupted. Refresh status or retry the same ZIP to recover registration."));
    xhr.ontimeout=()=>reject(new Error("Upload timed out. Refresh status or retry the same ZIP to recover registration."));
    xhr.send(file);
  });
}
function published(result,status){
  status.textContent=`Published ${result.month}: 10 images (${(result.bytes/1048576).toFixed(2)} MiB). Paid invoices will be processed automatically when configured.`;
  zipInput.value="";
  $("monthly-file-selection").textContent="Choose a Windows ZIP with 10 images.";
}
monthlyForm.addEventListener("submit",async event=>{
  event.preventDefault();
  if(monthlyBusy || !storageReady || !databaseReady)return;
  const file=zipInput.files[0], month=monthlyForm.elements.month.value, status=$("monthly-upload-status");
  if(!file || file.size>maxZip){status.textContent="Choose a ZIP of ten images up to 25 MiB.";return;}
  if(!month){status.textContent="Select the pack month.";return;}
  if(!window.confirm(`Publish the ${month} ZIP? It will be the permanent pack for paid subscribers in that billing month.`))return;
  monthlyBusy=true;syncMonthlyButtons();status.textContent="Uploading private monthly ZIP…";
  try{published(await uploadZip(file,month,status),status);}
  catch(error){status.textContent=error.message;}
  finally{monthlyBusy=false;await loadMonthly();}
});
registerButton.addEventListener("click",async()=>{
  if(monthlyBusy || !storageReady || !databaseReady)return;
  const month=monthlyForm.elements.month.value,status=$("monthly-upload-status");
  if(!month){status.textContent="Select the pack month.";return;}
  if(!window.confirm(`Register the existing private ${month}.zip as the permanent monthly pack? Paid subscribers will receive it.`))return;
  monthlyBusy=true;syncMonthlyButtons();status.textContent="Checking stored ZIP and registering…";
  try{
    const response=await fetch("/api/admin/monthly-delivery",{method:"POST",headers:{"X-Pack-Month":month,"X-Register-Existing":"true","Content-Type":"application/json"},body:"{}"});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||"Registration failed.");
    published(result,status);
  }catch(error){status.textContent=error.message;}
  finally{monthlyBusy=false;await loadMonthly();}
});

const login = $("admin-login");
const signOut = $("sign-out");
const stripePanel = $("stripe-panel");
const accessStatus = $("access-status");
let mode = "";

async function openWorkspace(session) {
  mode = session.mode || "";
  login.hidden = session.authenticated;
  signOut.hidden = orders.hidden = stripePanel.hidden = $("admin-actions").hidden =
    $("workflow-overview").hidden = $("campaign-publisher").hidden = monthlyPanel.hidden = !session.authenticated;
  if (session.authenticated) {
    accessStatus.textContent = "";
    await Promise.all([loadOrders(true), loadPortfolio(), loadMonthly()]);
  } else {
    login.querySelector("button").disabled = !session.passwordConfigured;
    accessStatus.textContent = session.passwordConfigured ? "" :
      "The admin login needs the ADMIN_PASSWORD Worker secret and the campaign database.";
  }
}

login.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = event.submitter;
  submit.disabled = true;
  try {
    const session = await api("/api/admin/session", "POST", {password: login.elements.password.value});
    login.reset();
    await openWorkspace(session);
  } catch (error) {
    accessStatus.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

signOut.addEventListener("click", async () => {
  if (mode === "access") {
    location.assign("/cdn-cgi/access/logout");
    return;
  }
  try {
    await api("/api/admin/session", "DELETE");
    location.reload();
  } catch (error) {
    accessStatus.textContent = error.message;
  }
});

$("check-stripe").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const status = $("stripe-status");
  button.disabled = true;
  status.textContent = "Checking the Stripe Checkout API…";
  try {
    const result = await api("/api/admin/stripe");
    status.textContent = result.message;
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

try {
  const session = await api("/api/admin/session");
  if (typeof session.authenticated !== "boolean") throw new Error("Missing login status.");
  await openWorkspace(session);
} catch {
  accessStatus.textContent = "Open this site through its Cloudflare Worker to sign in.";
}
