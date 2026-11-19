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

function renderOrders() {
  const query = $("order-search").value.trim().toLowerCase();
  const shown = rows.filter((order) =>
    [order.business, order.industry, order.buyer_email].some((field) => field.toLowerCase().includes(query)));
  list.replaceChildren(...shown.map((order) => {
    const delivery = order.email_delivered_at ? "Email sent" : "Awaiting email delivery";
    return row(order.business,
      `${offers[order.offer]} · ${order.buyer_email} · ${delivery}`,
      button("Open brief", () => openOrder(order)));
  }));
  $("more-orders").hidden = !more;
  $("order-status").textContent = shown.length
    ? `${shown.length} loaded ${shown.length === 1 ? "brief" : "briefs"} shown.`
    : query ? "No loaded briefs match this search." : "No campaign briefs have been submitted.";
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
  $("order-status").textContent = "Loading briefs…";
  try {
    const {orders: page, more: hasNext} = await adminApi(`?offset=${offset}`);
    if (request !== generation) return;
    more = hasNext;
    nextOffset = offset + page.length;
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
  status.textContent = "";
  renderDelivery(order);
  panel.showModal();
}

function renderDelivery(order) {
  const deliveryInstruction = `In Gmail, check that the From address is ${deliverySender} and attach the finished ZIP before sending.`;
  $("delivery-help").textContent = order.offer === "monthly"
    ? `Confirm the matching monthly invoice in Stripe. ${deliveryInstruction}`
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
    body: "Hi,\r\n\r\nYour finished campaign ZIP is attached.\r\n\r\nThanks,\r\nLoren\r\nPixel Shroom Studio"
  }).toString();
  $("compose-email").href = draft.href;
}

markSent.addEventListener("click", async () => {
  if (busy || !selected || !window.confirm("Have you sent the email with the ZIP attached?")) return;
  const order = selected;
  busy = markSent.disabled = true;
  try {
    const {email_delivered_at: sent} = await adminApi("", {
      sessionId: order.checkout_session_id,
      previous: order.email_delivered_at ?? null
    });
    if (!sent) throw new Error("The sent status could not be saved.");
    if (selected !== order) return;
    order.email_delivered_at = sent;
    renderOrders();
    renderDelivery(order);
    status.textContent = "Email marked as sent.";
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

const login = $("admin-login");
const signOut = $("sign-out");
const stripePanel = $("stripe-panel");
const accessStatus = $("access-status");
let mode = "";

async function openWorkspace(session) {
  mode = session.mode || "";
  login.hidden = session.authenticated;
  signOut.hidden = orders.hidden = stripePanel.hidden = $("admin-actions").hidden = !session.authenticated;
  if (session.authenticated) {
    accessStatus.textContent = "";
    await loadOrders(true);
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
