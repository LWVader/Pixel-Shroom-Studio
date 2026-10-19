import { mountFoilReveal } from "./foil-reveal.js?v=20261019-opening";
import { safeMintImage } from "./mint-core.js";
import { SUPABASE_URL } from "./config.js";
// SECTION: Supabase function client and checkout-return parameters
import { invoke, functionUrl } from "./supabase-client.js";

const parameters = new URLSearchParams(window.location.search);
const orderId = parameters.get("order");
const accessToken = parameters.get("access");

const heading = document.querySelector("#checkout-heading");
const message = document.querySelector("#checkout-message");
const downloadLink = document.querySelector("#download-link");

const MAX_STATUS_ATTEMPTS = 90;
const STATUS_DELAY_MS = 2_000;

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
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
  message.textContent = `Your original is ready. ${order.downloadsRemaining} ${downloadLabel} remaining before ${expiration}.`;
  const downloadUrl = new URL(order.downloadUrl);
  const expected = new URL(functionUrl("download-original"));
  if (
    downloadUrl.protocol !== "https:" ||
    downloadUrl.origin !== expected.origin ||
    downloadUrl.pathname !== expected.pathname
  ) {
    throw new Error(
      "The original delivery link is invalid. Contact the studio with your order number.",
    );
  }
  downloadLink.href = downloadUrl.href;
  downloadLink.hidden = false;
}

async function revealMint(order) {
  heading.textContent = "Payment verified — preparing your foil edition";
  if (order.mint?.state === "failed") {
    message.textContent =
      "Your edition number and rarity are reserved. Rendering needs studio attention; contact us with your order number.";
    return true;
  }
  if (order.mint?.state !== "ready") {
    message.textContent =
      "Your paid edition is queued. Keep this confirmation link or open My collection later; closing this page does not cancel rendering.";
    return false;
  }
  const result = await invoke("mint-access", {
    action: "status",
    orderId,
    accessToken,
    mintId: order.mint.id,
  });
  const item = result.items?.[0];
  if (!item?.imageUrl)
    throw new Error("Edition is not currently downloadable. Contact the studio.");
  heading.textContent = `${item.tier} edition revealed`;
  message.textContent = `#${item.mintNumber} of ${item.maxSupply} · ${item.width} × ${item.height} px. Your signed variant is ready.`;
  const panel = document.createElement("article");
  panel.className = "foil-card foil-purchase-reveal";
  panel.dataset.tier = item.tier;
  const image = document.createElement("img");
  image.src = safeMintImage(item.imageUrl, SUPABASE_URL);
  image.alt = `Your ${item.tier} foil edition`;
  panel.append(image);
  const download = document.createElement("button");
  download.className = "buy-button";
  download.textContent = "Download minted variant";
  download.onclick = async () => {
    try {
      const result = await invoke("mint-access", {
        action: "download",
        orderId,
        accessToken,
        mintId: item.id,
      });
      location.assign(safeMintImage(result.items?.[0]?.imageUrl, SUPABASE_URL));
    } catch (error) {
      message.textContent = error.message;
    }
  };
  const receipt = document.createElement("button");
  receipt.className = "buy-button";
  receipt.textContent = "Save signed receipt";
  receipt.onclick = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(item.manifest, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `mint-${item.id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  panel.append(download, receipt);
  message.after(panel);
  mountFoilReveal(panel, image);
  return true;
}

// SECTION: Secure order confirmation workflow
async function confirmOrder() {
  if (!orderId || !accessToken) {
    throw new Error("This confirmation link is incomplete.");
  }

  for (let attempt = 0; attempt < MAX_STATUS_ATTEMPTS; attempt += 1) {
    const order = await fetchOrderStatus();
    if (order.status === "paid") {
      if (order.kind === "foil") {
        if (await revealMint(order)) return;
      } else {
        showPaidOrder(order);
        return;
      }
    }

    await delay(STATUS_DELAY_MS);
  }

  if (heading.textContent.includes("preparing")) {
    message.textContent =
      "Your edition is still processing. Check My collection later; your number and tier are retained.";
    return;
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
