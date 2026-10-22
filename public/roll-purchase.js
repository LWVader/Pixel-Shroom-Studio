import { supabase, invoke } from "./supabase-client.js";
import { escapeHtml, safePreviewUrl, checkoutUrl } from "./catalog-core.js?v=20261022-loop";
import { editionDisclosure, FOIL_TIERS } from "./mint-core.js";
import { offerSummary } from "./forge-print-core.js?v=20261022-loop";
const form = document.querySelector("#roll-purchase");
if (form) {
  const status = document.querySelector("#roll-status"),
    pay = form.querySelector("[type=submit]");
  let availability = null;
  const artworkId = document.querySelector("#catalog")?.dataset.artworkId;
  const requested = new URLSearchParams(location.search).get("offer");
  if (["digital", "canvas"].includes(requested)) form.elements.offer.value = requested;
  function update() {
    const key = form.elements.offer.value,
      enabled = availability?.[key + "Enabled"] === true;
    document.querySelector("#roll-total").textContent = offerSummary(key);
    document.querySelector("#roll-included").textContent =
      key === "canvas"
        ? "One digital variant and one included US canvas claim. Production waits for your redemption; shipping is prepaid once. This edition cannot be used as a Forge input."
        : "One randomly assigned digital variant, automatically saved in My Vault. Eligible editions can be combined in the Forge. Canvas printing is optional and paid separately.";
    pay.disabled = !enabled;
    pay.textContent = enabled ? "Continue to secure payment →" : "This roll is not open yet";
  }
  form.addEventListener("change", update);
  update();
  try {
    availability = await invoke("forge-api", { action: "availability", artworkId });
    update();
    status.textContent =
      availability.digitalEnabled || availability.canvasEnabled
        ? "Payment comes first. Your variant remains concealed until the reveal."
        : "This collection is being prepared. Existing purchase options remain below when available.";
    const e = availability.edition;
    if (e) {
      document.querySelector("#roll-rules").textContent = editionDisclosure(e);
      document.querySelector("#roll-supply").textContent =
        `${e.totalMinted}/${e.maxSupply} issued · ${e.reserved || 0} checkout reservations · ${e.prismaticsRemaining} Prismatics remaining`;
      document.querySelector("#tier-previews").innerHTML = (availability.previews || [])
        .slice()
        .sort((a, b) => FOIL_TIERS.indexOf(a.tier) - FOIL_TIERS.indexOf(b.tier))
        .map(
          (p) =>
            `<article class="tier-preview"><h3>${escapeHtml(p.tier)}</h3>${p.previewUrl ? `<img src="${escapeHtml(safePreviewUrl(p.previewUrl))}" width="240" height="240" alt="Protected ${escapeHtml(p.tier)} variant preview" loading="lazy">` : "<p>Protected tier preview is being prepared.</p>"}<p>${Number(p.width)} × ${Number(p.height)} px · ${escapeHtml(p.mimeType)}</p></article>`,
        )
        .join("");
    }
  } catch {
    status.textContent =
      "Roll availability could not be checked. Please retry; no payment has been requested.";
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const offer = form.elements.offer.value;
    if (!availability?.[offer + "Enabled"]) return;
    pay.disabled = true;
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        location.assign(`/collection.html?art=${encodeURIComponent(artworkId)}&offer=${offer}`);
        return;
      }
      status.textContent =
        "Opening secure payment. Your tier is assigned only after payment is verified.";
      const result = await invoke("mint-checkout", { artworkId, offer }, data.session.access_token);
      location.assign(checkoutUrl(result.checkoutUrl, "stripe"));
    } catch (error) {
      status.textContent = error.message;
      update();
    }
  });
}
