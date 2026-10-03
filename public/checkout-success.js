// SECTION: Secure checkout return and webhook-confirmed fulfillment
const parameters = new URLSearchParams(location.search);
const supabase = window.PixelShroomSupabase;
const orderId = parameters.get("order");
const accessToken = parameters.get("access");
const provider = parameters.get("provider");
const heading = document.querySelector("#checkout-heading");
const message = document.querySelector("#checkout-message");
const downloadLink = document.querySelector("#download-link");

async function capturePayPalOrder() {
  const paypalOrderId = parameters.get("token");
  if (provider !== "paypal" || !paypalOrderId) return;
  await supabase.invoke("paypal-capture", { orderId, accessToken, paypalOrderId });
}

async function orderStatus() {
  return supabase.invoke("order-status", { orderId, accessToken });
}

async function confirmOrder() {
  if (!orderId || !accessToken) throw new Error("This confirmation link is incomplete.");
  await capturePayPalOrder();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const order = await orderStatus();
    if (order.status === "paid") {
      heading.textContent = "Payment verified";
      if (order.category === "NFT") {
        message.textContent = "Your NFT order is recorded. The ZIP package will be sent manually to the delivery email supplied at checkout.";
      } else if (order.downloadUrl) {
        message.textContent = "Your protected original is ready. This private link expires and has a limited number of downloads.";
        downloadLink.href = order.downloadUrl;
        downloadLink.hidden = false;
      } else {
        message.textContent = "Payment is verified, but the download is no longer available. Contact Pixel Shroom Studio with your order number.";
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  heading.textContent = "Payment is still processing";
  message.textContent = "The payment provider has not confirmed the webhook yet. Keep this page and refresh it shortly; no original is released before verification.";
}

confirmOrder().catch((error) => {
  heading.textContent = "Order confirmation unavailable";
  message.textContent = error.message;
});
