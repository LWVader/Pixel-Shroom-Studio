import { mountFoilReveal } from "./foil-reveal.js?v=20261019-paid-profile";
import { safeMintImage } from "./mint-core.js";
import { SUPABASE_URL } from "./config.js";
// SECTION: Supabase function client and checkout-return parameters
import { supabase, invoke, functionUrl } from "./supabase-client.js";

const parameters = new URLSearchParams(window.location.search);
const orderId = parameters.get("order");
const accessToken = parameters.get("access");
const recoveryMint = parameters.get("mint");
let waitingPanel, waitingEffect;
function clearWaiting() {
  waitingEffect?.cleanup();
  waitingPanel?.remove();
  waitingPanel = null;
}
function showWaiting() {
  if (waitingPanel) return;
  waitingPanel = document.createElement("article");
  waitingPanel.className = "foil-card foil-purchase-reveal";
  const image = document.createElement("img");
  image.src =
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640"><rect width="480" height="640" fill="#121525"/></svg>',
    );
  image.alt = "Concealed paid edition";
  waitingPanel.append(image);
  message.after(waitingPanel);
  waitingEffect = mountFoilReveal(waitingPanel, image, {
    concealed: true,
    waitingMessage:
      "Payment verified. Secure allocation and private image preparation in progress…",
  });
}
async function mintAccess(action, mintId) {
  const { data } = await supabase.auth.getSession();
  return invoke(
    "mint-access",
    {
      action,
      mintId,
      ...(!recoveryMint && action !== "add_to_collection" ? { orderId, accessToken } : {}),
    },
    data.session?.access_token,
  );
}

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
    clearWaiting();
    message.textContent =
      "Your edition number and rarity are reserved. Image delivery needs studio attention; contact us with your order number.";
    return true;
  }
  if (order.mint?.state !== "ready") {
    showWaiting();
    message.textContent =
      "Your paid edition is queued. Keep this confirmation link or open My collection later; closing this page does not cancel delivery.";
    return false;
  }
  const result = await mintAccess("status", order.mint.id);
  const item = result.items?.[0];
  if (!item?.imageUrl)
    throw new Error("Edition is not currently downloadable. Contact the studio.");
  clearWaiting();
  heading.textContent = "Revealing your paid edition";
  message.textContent = "Your server-assigned edition is ready. Opening the sealed card…";
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
      const result = await mintAccess("download", item.id);
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
  const add = document.createElement("button");
  add.className = "buy-button";
  add.textContent = item.inCollection ? "Already in my collection" : "Add to my collection";
  add.disabled = Boolean(item.inCollection);
  add.onclick = async () => {
    add.disabled = true;
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        location.assign("/collection.html?reveal=" + encodeURIComponent(item.id));
        return;
      }
      const result = await mintAccess("add_to_collection", item.id);
      if (!result.added) throw new Error("Could not add this edition. Please retry.");
      add.textContent = "Added to my collection";
      message.textContent = "Your edition is saved to your account profile.";
    } catch (error) {
      message.textContent = error.message;
      add.disabled = false;
    }
  };
  for (const button of [download, receipt, add]) button.hidden = true;
  panel.append(download, receipt, add);
  message.after(panel);
  mountFoilReveal(panel, image, {
    onStart: () => {
      for (const button of [download, receipt, add]) button.hidden = true;
    },
    onComplete: () => {
      heading.textContent = `${item.tier} edition revealed`;
      message.textContent = `#${item.mintNumber} of ${item.maxSupply} · ${item.width} × ${item.height} px. Add this edition to your account profile below.`;
      for (const button of [download, receipt, add]) button.hidden = false;
    },
  });
  return true;
}

// SECTION: Secure order confirmation workflow
async function confirmOrder() {
  if (!recoveryMint && (!orderId || !accessToken)) {
    throw new Error("This confirmation link is incomplete.");
  }

  for (let attempt = 0; attempt < MAX_STATUS_ATTEMPTS; attempt += 1) {
    let order;
    if (recoveryMint) {
      const result = await mintAccess("status", recoveryMint);
      const item = result.items?.[0];
      if (!item?.paymentConfirmed)
        throw new Error("Sign in with the purchasing account to view this paid edition.");
      order = { status: "paid", kind: "foil", mint: item };
    } else order = await fetchOrderStatus();
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

  clearWaiting();
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
  clearWaiting();
  console.error("Order confirmation failed:", error);
  heading.textContent = "Order confirmation unavailable";
  message.textContent = error.message || "The order could not be confirmed.";
});
