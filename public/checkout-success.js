// SECTION: Supabase function client and checkout-return parameters
import { invoke } from "./supabase-client.js";

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

// SECTION: Verified payment result and private delivery
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

  const expiration = new Date(order.expiresAt).toLocaleString();
  const downloadLabel = order.downloadsRemaining === 1 ? "download" : "downloads";
  message.textContent =
    `Your original is ready. ${order.downloadsRemaining} ${downloadLabel} remaining before ${expiration}.`;
  downloadLink.href = order.downloadUrl;
  downloadLink.hidden = false;
}

// SECTION: Secure order confirmation workflow
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
    "The payment provider has not confirmed the payment yet. Refresh this page shortly; the original remains protected until verification completes.";
}

confirmOrder().catch((error) => {
  console.error("Order confirmation failed:", error);
  heading.textContent = "Order confirmation unavailable";
  message.textContent = error.message || "The order could not be confirmed.";
});
