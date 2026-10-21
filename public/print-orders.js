import { supabase, invoke } from "./supabase-client.js";
import { escapeHtml } from "./catalog-core.js";
const status = document.querySelector("#print-order-status"),
  list = document.querySelector("#print-order-list");
const selected = new URLSearchParams(location.search).get("order");
async function load() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    status.textContent = "Sign in to your studio account to view physical orders.";
    return false;
  }
  const call = (body) => invoke("print-api", body, data.session.access_token);
  if (selected) await call({ action: "order", orderId: selected });
  const { orders } = await call({ action: "orders" });
  list.innerHTML = orders
    .map(
      (o) =>
        `<article class="print-order"><h2>${escapeHtml(o.title)}</h2><p>${escapeHtml(o.variant)} · Quantity ${Number(o.quantity)}</p><p>${o.testMode ? "Test order · " : ""}${o.state === "canceled" ? "Checkout expired or canceled" : o.paymentState === "pending" ? "Waiting for verified payment" : o.paymentState === "paid" ? "Payment confirmed" : escapeHtml(o.paymentState)}</p><p>${o.state === "needs_review" ? "The studio is reviewing this order. Contact us with your order reference." : escapeHtml(o.status || o.state.replaceAll("_", " "))}</p><p>Order reference: ${escapeHtml(o.id)}</p>${(
          o.tracking || []
        )
          .map((t) => {
            let url = "";
            try {
              const u = new URL(t.url);
              if (u.protocol === "https:") url = u.href;
            } catch {}
            return url
              ? `<p><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Track package ${escapeHtml(t.code)} ↗</a></p>`
              : "";
          })
          .join("")}</article>`,
    )
    .join("");
  const pending = orders.some(
    (o) => o.id === selected && o.paymentState === "pending" && o.state !== "canceled",
  );
  status.textContent = pending
    ? "Checking payment confirmation…"
    : orders.length
      ? "Your physical orders. No digital downloads are issued for these purchases."
      : "You have no physical orders yet.";
  return pending;
}
let busy = false;
document.querySelector("#refresh-print-orders").onclick = async () => {
  if (busy) return;
  busy = true;
  try {
    await load();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    busy = false;
  }
};
try {
  for (let i = 0; i < 30; i++) {
    if (!(await load())) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
} catch (error) {
  status.textContent = error.message;
}
