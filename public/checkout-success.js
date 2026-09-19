import { invoke } from "./supabase-client.js";
const parameters = new URLSearchParams(location.search), orderId = parameters.get("order"), accessToken = parameters.get("access"), provider = parameters.get("provider");
const heading = document.querySelector("#checkout-heading"), message = document.querySelector("#checkout-message"), downloadLink = document.querySelector("#download-link");
async function check(attempt = 0) {
  if (!orderId || !accessToken) { heading.textContent = "Invalid checkout link"; message.textContent = "The order reference is missing."; return; }
  try {
    const order = await invoke("order-status", { orderId, accessToken });
    if (order.status === "paid") {
      heading.textContent = order.fulfillmentStatus === "email_pending" ? "Payment confirmed" : "Your artwork is ready";
      message.textContent = order.fulfillmentStatus === "email_pending" ? "Your NFT package will be emailed by the studio." : "The private link expires and has a limited number of downloads.";
      if (order.downloadUrl) { downloadLink.href = order.downloadUrl; downloadLink.hidden = false; }
      return;
    }
    if (attempt < 15) return setTimeout(() => check(attempt + 1), 2000);
    heading.textContent = "Payment verification is pending"; message.textContent = "Refresh this page shortly.";
  } catch (error) { heading.textContent = "Unable to verify payment"; message.textContent = error.message; }
}
async function start() {
  if (provider === "paypal" && parameters.get("token")) {
    try { await invoke("paypal-capture", { orderId, accessToken, paypalOrderId: parameters.get("token") }); }
    catch (error) { console.warn(error); }
  }
  check();
}
start();
