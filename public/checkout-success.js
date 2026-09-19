// SECTION: Supabase client and checkout-return parameters
import { supabase } from "./supabase-client.js";

const parameters = new URLSearchParams(window.location.search);
const orderId = parameters.get("order");
const accessToken = parameters.get("access");
const provider = parameters.get("provider");
const heading = document.querySelector("#checkout-heading");
const message = document.querySelector("#checkout-message");
const downloadLink = document.querySelector("#download-link");

const MAX_STATUS_ATTEMPTS = 15;
const STATUS_DELAY_MS = 2_000;

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function invoke(functionName, body) {
  const { data, error } = await supabase.functions.invoke(functionName, { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

// SECTION: PayPal capture after buyer approval
async function capturePayPalOrder() {
  const paypalOrderId = parameters.get("token");
  if (provider !== "paypal" || !paypalOrderId) return;

  await invoke("paypal-capture", {
    orderId,
    accessToken,
    paypalOrderId,
  });
}

// SECTION: Webhook-confirmed order polling
async function fetchOrderStatus() {
  return invoke("order-status", { orderId, accessToken });
}

function showPaidOrder(order) {
  heading.textContent = "Payment verified";

  if (order.category === "NFT") {
    message.textContent =
      "Your NFT order is recorded. The ZIP package will be sent manually to the delivery email supplied at checkout.";
    return;
  }

  if (!order.downloadUrl) {
    message.textContent =
      "Payment is verified, but the download is unavailable or has expired. Contact Pixel Shroom Studio with your order number.";
    return;
  }

  message.textContent =
    `Your original is ready. ${order.downloadsRemaining} download` +
    `${order.downloadsRemaining === 1 ? "" : "s"} remaining before ${new Date(order.expiresAt).toLocaleString()}.`;
  downloadLink.href = order.downloadUrl;
  downloadLink.hidden = false;
}

async function confirmOrder() {
  if (!orderId || !accessToken) {
    throw new Error("This confirmation link is incomplete.");
  }

  await capturePayPalOrder();

  for (let attempt = 0; attempt < MAX_STATUS_ATTEMPTS; attempt += 1) {
    const order = await fetchOrderStatus();
    if (order.status === "paid") {
      showPaidOrder(order);
      return;
    }
    await delay(STATUS_DELAY_MS);
  }

  heading.textContent = "Payment is still processing";
  message.textContent =
    "The payment provider has not confirmed the webhook yet. Keep this page and refresh it shortly; no original is released before verification.";
}

confirmOrder().catch((error) => {
  console.error("Order confirmation failed:", error);
  heading.textContent = "Order confirmation unavailable";
  message.textContent = error.message || "The order could not be confirmed.";
});
