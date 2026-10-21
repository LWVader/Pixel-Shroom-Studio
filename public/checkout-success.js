import { mountFoilReveal } from "./foil-reveal.js?v=20261021-immediate-opening";
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
  waitingEffect = null;
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
    waiting: true,
    mystery: true,
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
  showWaiting();
  if (order.mint?.state !== "ready") {
    message.textContent =
      "Your paid edition is queued. Keep this confirmation link or open My collection later; closing this page does not cancel delivery.";
    return false;
  }
  const result = await mintAccess("status", order.mint.id);
  const item = result.items?.[0];
  if (!item?.imageUrl)
    throw new Error("Edition is not currently downloadable. Contact the studio.");
  heading.textContent = "Revealing your paid edition";
  message.textContent = "Your server-assigned edition is ready. Opening the sealed card…";
  const panel = waitingPanel;
  panel.className = "foil-card foil-purchase-reveal";
  panel.dataset.tier = item.tier;
  function saveFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  let savedToCollection = Boolean(item.inCollection);
  const add = document.createElement("button");
  add.className = "buy-button";
  add.textContent = item.inCollection ? "Download my edition files" : "Add to my collection";
  add.onclick = async () => {
    add.disabled = true;
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        location.assign("/collection.html?reveal=" + encodeURIComponent(item.id));
        return;
      }
      if (!savedToCollection) {
        const result = await mintAccess("add_to_collection", item.id);
        if (!result.added) throw new Error("Could not add this edition. Please retry.");
        savedToCollection = true;
      }
      add.textContent = "Preparing your files…";
      const delivery = await mintAccess("download", item.id);
      const response = await fetch(safeMintImage(delivery.items?.[0]?.imageUrl, SUPABASE_URL), {
        credentials: "omit",
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error("Image download unavailable. Retry downloading your files.");
      const blob = await response.blob();
      const extensions = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
      const extension = extensions[blob.type.split(";")[0]];
      if (!extension)
        throw new Error("Unexpected image format. Please retry or contact the studio.");
      if (!item.manifest) throw new Error("Signed receipt unavailable. Please contact the studio.");
      saveFile(blob, `mint-${item.id}.${extension}`);
      saveFile(
        new Blob([JSON.stringify(item.manifest, null, 2)], { type: "application/json" }),
        `mint-${item.id}.json`,
      );
      add.textContent = "Download my edition files again";
      message.textContent =
        "Saved in your collection. Image and signed receipt downloads requested. Allow multiple downloads if your browser asks.";
    } catch (error) {
      message.textContent =
        (savedToCollection ? "Your edition is saved in your collection. " : "") + error.message;
      add.textContent = savedToCollection ? "Retry downloading my files" : "Add to my collection";
    } finally {
      add.disabled = false;
    }
  };
  add.hidden = true;
  const actions = document.createElement("div");
  actions.className = "foil-purchase-actions";
  actions.append(add);
  panel.append(actions);
  message.after(panel);
  await waitingEffect.resolveEdition({
    src: safeMintImage(item.imageUrl, SUPABASE_URL),
    alt: `Your ${item.tier} foil edition`,
    onStart: () => {
      heading.textContent = "Revealing your paid edition";
      message.textContent =
        "Opening your prepared edition. Replaying does not change its tier or file.";
      add.hidden = true;
    },
    onComplete: () => {
      heading.textContent = `${item.tier} edition revealed`;
      message.textContent = `#${item.mintNumber} of ${item.maxSupply} · ${item.width} × ${item.height} px. ${savedToCollection ? "Saved in your collection." : "Add this edition to your account profile below."}`;
      add.hidden = false;
    },
  });
  waitingPanel = null;
  waitingEffect = null;
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
