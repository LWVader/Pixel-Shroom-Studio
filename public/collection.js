import { setupMarketSelling } from "./market-sell.js";
import { supabase, invoke } from "./supabase-client.js";
import { SUPABASE_URL } from "./config.js";
import { escapeHtml, checkoutUrl } from "./catalog-core.js?v=20261022-loop";
import { editionDisclosure, safeMintImage } from "./mint-core.js?v=20261021-edition-language";
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
let currentItems = [];
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
// Paid editions remain recoverable if the buyer leaves before saving to profile.
let pendingOffset = 0;
const pending = document.createElement("section");
pending.id = "uncollected-purchases";
grid.before(pending);
async function loadUncollected() {
  const { items, hasMore } = await call("uncollected", { offset: pendingOffset });
  pending.replaceChildren();
  if (!items.length && pendingOffset === 0) return;
  const title = document.createElement("h2");
  title.textContent = "Purchases waiting to add";
  pending.append(title);
  for (const item of items) {
    const row = document.createElement("p");
    row.append(document.createTextNode(`${item.title}: `));
    if (item.paymentConfirmed) {
      const link = document.createElement("a");
      link.href = "/checkout-success.html?mint=" + encodeURIComponent(item.id);
      link.textContent = "View reveal and add to my collection";
      row.append(link);
    } else row.append(document.createTextNode("Awaiting payment confirmation"));
    pending.append(row);
  }
  for (const [label, enabled, direction] of [
    ["Previous purchases", pendingOffset > 0, -1],
    ["Next purchases", hasMore, 1],
  ]) {
    if (!enabled) continue;
    const button = document.createElement("button");
    button.textContent = label;
    button.className = "button";
    button.onclick = () => {
      pendingOffset = Math.max(0, pendingOffset + direction * 25);
      loadUncollected().catch((error) => showStatus(error.message));
    };
    pending.append(button);
  }
}

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
    window.dispatchEvent(new Event("studio:collection-saved"));
    currentItems = items;
    renderPrintChoices();
    grid.innerHTML = items
      .map((item) => {
        const url = item.imageUrl ? safeMintImage(item.imageUrl, SUPABASE_URL) : "";
        const fresh = item.state === "ready" && !seen.has(item.id);
        if (item.state === "ready") seen.add(item.id);
        return `<article class="foil-card${fresh ? " revealed" : ""}" data-tier="${escapeHtml(item.tier || "Standard")}"><h2>${escapeHtml(item.title)}</h2><p>${item.tier ? `${escapeHtml(item.tier)} · #${item.mintNumber} of ${item.maxSupply}` : "Awaiting verified payment"}</p>${url ? `<img src="${escapeHtml(url)}" alt="Your ${escapeHtml(item.tier)} variant of ${escapeHtml(item.title)}" loading="lazy"><p>${item.width} × ${item.height} px</p><button class="button" data-download="${escapeHtml(item.id)}">Download variant</button> <button class="button" data-receipt="${escapeHtml(item.id)}">Save signed receipt</button><a class="button secondary" href="/canvases.html?mint=${encodeURIComponent(item.id)}">Print this edition</a> <a class="text-link" href="/collection.html?tab=forge">Forge progress →</a>${item.canList ? `<button class="button" data-sell="${escapeHtml(item.id)}">List on Market</button>` : ""}` : `<p>${item.state === "failed" ? "Processing needs studio attention; your number and tier are retained. Please contact us." : escapeHtml(item.state === "forged" ? "Combined in the Forge. This consumed edition stays in your history." : item.state)}</p>`}</article>`;
      })
      .join("");
    await loadUncollected();
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
    currentItems = [];
    renderPrintChoices();
    document.querySelector("#print-order-list")?.replaceChildren();
    const forge = document.querySelector("#vault-forge");
    if (forge) forge.textContent = "Sign in to see your eligible editions.";
    pending.replaceChildren();
    showStatus("Sign in to mint and view your private editions.");
  } else {
    const recover = new URLSearchParams(location.search).get("reveal");
    if (recover) {
      location.assign("/checkout-success.html?mint=" + encodeURIComponent(recover));
      return;
    }
    const art = new URLSearchParams(location.search).get("art"),
      offer = new URLSearchParams(location.search).get("offer");
    if (art && /^\d{1,15}$/.test(art)) {
      location.assign(
        `/art.html?id=${encodeURIComponent(art)}&offer=${offer === "canvas" ? "canvas" : "digital"}`,
      );
      return;
    }
    if (new URLSearchParams(location.search).get("recovery") === "1")
      document.querySelector("#recovery-password").hidden = false;
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
  mintPanel.innerHTML = `<h2>Collect a numbered digital edition</h2><p>${edition.totalMinted}/${edition.maxSupply} allocated · ${edition.prismaticsRemaining} Prismatics remaining · ${edition.reserved} checkout reservations</p><p>${escapeHtml(editionDisclosure(edition))}</p><p>The gallery shows a protected artwork preview. Your server-assigned tier releases one of the studio’s finished uploaded images; no frames or overlays are generated at checkout. The private master is not delivered. After verified payment, one continuous spin reveals your edition. The ready edition saves automatically in My Vault; download its image and signed receipt after reveal. Usage rights stay as published; the underlying design remains nonexclusive.</p><p>Price: ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(edition.price))}</p><button class="button" id="start-mint" ${!session || edition.totalMinted + edition.reserved >= edition.maxSupply ? "disabled" : ""}>${session ? "Pay with Stripe and mint" : "Sign in below to mint"}</button>`;
  if (edition.tierImages?.length) {
    const sizes = document.createElement("p");
    sizes.textContent =
      "Finished tier sizes: " +
      edition.tierImages
        .map((image) => `${image.tier}: ${image.width} × ${image.height} px`)
        .join("; ");
    mintPanel.querySelector("#start-mint").before(sizes);
  }
  mintPanel.querySelector("#start-mint").onclick = async (event) => {
    event.target.disabled = true;
    try {
      const result = await invoke("mint-checkout", { artworkId: target }, session.access_token);
      location.assign(checkoutUrl(result.checkoutUrl, "stripe"));
    } catch (error) {
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

function renderPrintChoices() {
  const root = document.querySelector("#vault-print-list");
  if (!root) return;
  const items = currentItems.filter((i) => i.state === "ready" && i.imageUrl);
  root.innerHTML = items.length
    ? items
        .map(
          (i) =>
            `<article class="vault-print-card"><h3>${escapeHtml(i.title)}</h3><p>${escapeHtml(i.tier)} · #${Number(i.mintNumber)}</p><a class="button" href="/canvases.html?mint=${encodeURIComponent(i.id)}">Review canvas &amp; claim status →</a></article>`,
        )
        .join("")
    : "<p>No ready printable editions on this collection page yet. Use My Artwork to load another page of editions.</p>";
}
window.addEventListener("studio:prints-requested", renderPrintChoices);
const resetButton = document.querySelector("#password-reset");
resetButton?.addEventListener("click", async () => {
  const email = authForm.elements.email.value.trim();
  if (!email || !authForm.elements.email.reportValidity()) return;
  resetButton.disabled = true;
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: location.origin + "/collection.html?recovery=1",
    });
    if (error) throw error;
    showStatus(
      "If an account matches, a password-reset email has been requested. Check your inbox.",
    );
  } catch {
    showStatus("The reset email could not be requested. Please retry or contact the studio.");
  } finally {
    resetButton.disabled = false;
  }
});
const recovery = document.querySelector("#recovery-password");
supabase.auth.onAuthStateChange((event) => {
  if (event === "PASSWORD_RECOVERY" && recovery) {
    recovery.hidden = false;
    recovery.scrollIntoView({ block: "center" });
  }
});
recovery?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (recovery.elements.password.value !== recovery.elements.confirmation.value) {
    showStatus("Passwords must match.");
    return;
  }
  const button = recovery.querySelector("button");
  button.disabled = true;
  try {
    const { error } = await supabase.auth.updateUser({
      password: recovery.elements.password.value,
    });
    if (error) throw error;
    recovery.reset();
    recovery.hidden = true;
    showStatus("Your password has been updated.");
  } catch (error) {
    showStatus(error.message);
  } finally {
    button.disabled = false;
  }
});
