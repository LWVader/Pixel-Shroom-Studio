import { beginCheckoutOpening } from "./foil-reveal.js?v=20261019-template";
import { setupMarketSelling } from "./market-sell.js";
import { supabase, invoke } from "./supabase-client.js";
import { SUPABASE_URL } from "./config.js";
import { escapeHtml, checkoutUrl } from "./catalog-core.js";
import { editionDisclosure, safeMintImage } from "./mint-core.js?v=20261019-six-tiers";
const status = document.querySelector("#collection-status");
const grid = document.querySelector("#mint-collection");
const login = document.querySelector("#collection-login");
const authForm = document.querySelector("#collection-auth");
const signOut = document.querySelector("#collection-signout");
const mintPanel = document.querySelector("#mint-panel");
const target = new URLSearchParams(location.search).get("mint");
let session;
let sellerReturnChecked = false;
let busy = false;
let offset = 0;
const next = document.querySelector("#collection-next"),
  previous = document.querySelector("#collection-previous");
next.onclick = () => {
  offset += 25;
  load();
};
previous.onclick = () => {
  offset = Math.max(0, offset - 25);
  load();
};
const seen = new Set();
const selling = setupMarketSelling({ getSession: () => session, showStatus });
function showStatus(message) {
  status.textContent = message;
}
async function call(action, fields = {}) {
  return invoke("mint-access", { action, ...fields }, session?.access_token);
}
async function load() {
  if (!session || busy) return;
  busy = true;
  const requestedToken = session.access_token;
  try {
    const { items, hasMore } = await call("collection", { offset });
    if (session?.access_token !== requestedToken) return;
    grid.innerHTML = items
      .map((item) => {
        const url = item.imageUrl ? safeMintImage(item.imageUrl, SUPABASE_URL) : "";
        const fresh = item.state === "ready" && !seen.has(item.id);
        if (item.state === "ready") seen.add(item.id);
        return `<article class="foil-card${fresh ? " revealed" : ""}" data-tier="${escapeHtml(item.tier || "Standard")}"><h2>${escapeHtml(item.title)}</h2><p>${item.tier ? `${escapeHtml(item.tier)} · #${item.mintNumber} of ${item.maxSupply}` : "Awaiting verified payment"}</p>${url ? `<img src="${escapeHtml(url)}" alt="Your ${escapeHtml(item.tier)} variant of ${escapeHtml(item.title)}" loading="lazy"><p>${item.width} × ${item.height} px</p><button class="button" data-download="${escapeHtml(item.id)}">Download variant</button> <button class="button" data-receipt="${escapeHtml(item.id)}">Save signed receipt</button>${item.canList ? `<button class="button" data-sell="${escapeHtml(item.id)}">List on Market</button>` : ""}` : `<p>${item.state === "failed" ? "Processing needs studio attention; your number and tier are retained. Please contact us." : escapeHtml(item.state)}</p>`}</article>`;
      })
      .join("");
    next.hidden = !hasMore;
    previous.hidden = offset === 0;
    showStatus(
      items.length
        ? `Showing editions ${offset + 1}–${offset + items.length}. Private image links refresh while this page is open.`
        : "Your collection is empty. Explore the artwork to find an available foil edition.",
    );
  } catch (error) {
    showStatus(error.message);
  } finally {
    busy = false;
  }
}
async function updateSession() {
  const { data } = await supabase.auth.getSession();
  session = data.session;
  login.hidden = Boolean(session);
  signOut.hidden = !session;
  if (!session) {
    offset = 0;
    next.hidden = true;
    previous.hidden = true;
    grid.replaceChildren();
    showStatus("Sign in to mint and view your private editions.");
  } else {
    await load();
    if (!sellerReturnChecked && new URLSearchParams(location.search).has("connect")) {
      sellerReturnChecked = true;
      await selling.refresh();
    }
  }
  if (target) await showMintOffer();
}
async function showMintOffer() {
  const { data, error } = await supabase.rpc("foil_catalog");
  const edition = data?.find((item) => String(item.artworkId) === target && item.enabled);
  if (error || !edition) {
    mintPanel.hidden = false;
    mintPanel.textContent = "This foil edition is unavailable.";
    return;
  }
  mintPanel.hidden = false;
  mintPanel.innerHTML = `<h2>Mint a numbered foil edition</h2><p>${edition.totalMinted}/${edition.maxSupply} allocated · ${edition.prismaticsRemaining} Prismatics remaining · ${edition.reserved} checkout reservations</p><p>${escapeHtml(editionDisclosure(edition))}</p><p>The artwork shown in the gallery is the protected master preview. Your finished variant may have a border or color effect. The private master is not delivered. Usage rights stay as published; a numbered edition does not make the underlying design exclusive.</p><p>Price: ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(edition.price))}</p><button class="button" id="start-mint" ${!session || edition.totalMinted + edition.reserved >= edition.maxSupply ? "disabled" : ""}>${session ? "Pay with Stripe and mint" : "Sign in below to mint"}</button>`;
  mintPanel.querySelector("#start-mint").onclick = async (event) => {
    event.target.disabled = true;
    const opening = beginCheckoutOpening();
    try {
      const [result] = await Promise.all([
        invoke("mint-checkout", { artworkId: target }, session.access_token),
        opening.ready,
      ]);
      location.assign(checkoutUrl(result.checkoutUrl, "stripe"));
    } catch (error) {
      opening.close();
      showStatus(error.message);
      event.target.disabled = false;
    }
  };
}
authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  const values = new FormData(authForm);
  try {
    const credentials = {
      email: String(values.get("email")),
      password: String(values.get("password")),
    };
    const result =
      button.value === "signup"
        ? await supabase.auth.signUp(credentials)
        : await supabase.auth.signInWithPassword(credentials);
    if (result.error) throw result.error;
    authForm.reset();
    await updateSession();
    if (!result.data.session)
      showStatus("Check your email to confirm your account, then sign in here.");
  } catch (error) {
    showStatus(error.message);
  } finally {
    button.disabled = false;
  }
});
signOut.onclick = async () => {
  await supabase.auth.signOut();
  await updateSession();
};
grid.onclick = async (event) => {
  const sell = event.target.closest("[data-sell]");
  if (sell) {
    await selling.open(sell.dataset.sell);
    return;
  }
  const download = event.target.closest("[data-download]");
  const receipt = event.target.closest("[data-receipt]");
  if (!download && !receipt) return;
  try {
    const { items } = await call(download ? "download" : "status", {
      mintId: (download || receipt).dataset[download ? "download" : "receipt"],
    });
    const item = items[0];
    if (!item?.imageUrl) throw new Error("This edition is not currently downloadable.");
    if (download) location.assign(safeMintImage(item.imageUrl, SUPABASE_URL));
    else {
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(item.manifest, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `mint-${item.id}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  } catch (error) {
    showStatus(error.message);
  }
};
updateSession().catch((error) => showStatus(error.message));
supabase.auth.onAuthStateChange(() =>
  setTimeout(() => updateSession().catch((error) => showStatus(error.message)), 0),
);
setInterval(() => {
  if (!document.hidden && session) load();
}, 15000);
