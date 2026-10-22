import { supabase, invoke } from "./supabase-client.js";
import { escapeHtml } from "./catalog-core.js?v=20261022-loop";
import { FORGE_RECIPES, artUrl } from "./forge-print-core.js?v=20261022-loop";
const root = document.querySelector("#vault-forge");
let busy = false,
  requestId = null,
  lastIds = "";
export async function loadForge() {
  if (!root || busy) return;
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    root.innerHTML = "<p>Sign in to see your eligible editions.</p>";
    return;
  }
  try {
    const response = await invoke("forge-api", { action: "inventory" }, data.session.access_token);
    const current = await supabase.auth.getSession();
    if (current.data.session?.access_token !== data.session.access_token) {
      root.replaceChildren();
      return;
    }
    const groups = new Map();
    for (const item of response.items || []) {
      if (!item.eligible) continue;
      const key = `${item.artworkId}:${item.tier}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    root.innerHTML = `<p>${response.forgeEnabled ? "Select the exact editions to combine." : "The Forge is being prepared; your eligible progress is shown below."} Digital-only editions only. Printed, listed, held or canvas-inclusive editions cannot be consumed.</p>${response.hasMore ? "<p>Showing the most recent 1,000 ready editions. Contact the studio for older inventory.</p>" : ""}`;
    for (const items of groups.values()) {
      const first = items[0],
        recipe = FORGE_RECIPES.find((r) => r.from === first.tier);
      if (!recipe) continue;
      const section = document.createElement("form");
      section.className = "forge-group";
      section.innerHTML = `<h3>${escapeHtml(first.title)}</h3><p>${items.length} ${escapeHtml(first.tier)} available · ${recipe.quantity} required for one ${recipe.to}</p><fieldset><legend>Choose ${recipe.quantity} input editions</legend>${items.map((i) => `<label><input type="checkbox" name="mint" value="${escapeHtml(i.id)}"> ${escapeHtml(i.tier)} · ${escapeHtml(i.mintNumber ? "#" + i.mintNumber : i.id.slice(0, 8))}</label>`).join("")}</fieldset><p>These selected edition records will be permanently consumed. Previously downloaded files and published usage rights remain unchanged. The output requires available authorized inventory; no free print is included.</p><label><input type="checkbox" name="confirm" required> I understand this permanently combines my selected editions.</label><button class="button" type="submit" ${response.forgeEnabled && items.length >= recipe.quantity ? "" : "disabled"}>Combine into ${recipe.to}</button><p class="forge-result" role="status"></p><a class="text-link" href="${artUrl(first.artworkId, "digital")}">Roll this artwork again →</a>`;
      section.onsubmit = async (event) => {
        event.preventDefault();
        if (busy || !section.reportValidity()) return;
        const ids = new FormData(section).getAll("mint").map(String).sort(),
          result = section.querySelector(".forge-result"),
          button = section.querySelector("button");
        if (ids.length !== recipe.quantity) {
          result.textContent = `Select exactly ${recipe.quantity} editions.`;
          return;
        }
        const key = ids.join(",");
        if (lastIds !== key || !requestId) {
          requestId = crypto.randomUUID();
          lastIds = key;
        }
        busy = true;
        button.disabled = true;
        try {
          const { data } = await supabase.auth.getSession();
          if (!data.session) throw Error("Sign in again.");
          const output = await invoke(
            "forge-api",
            { action: "forge", requestId, mintIds: ids },
            data.session.access_token,
          );
          location.assign("/checkout-success.html?mint=" + encodeURIComponent(output.mintId));
        } catch (error) {
          result.textContent =
            error.message +
            " If the connection failed, retry these same inputs to recover the same operation.";
          busy = false;
          button.disabled = false;
        }
      };
      root.append(section);
    }
    if (!groups.size)
      root.insertAdjacentHTML(
        "beforeend",
        '<p>No eligible digital-only editions yet. Choose an artwork and start your collection.</p><a class="button" href="/all-artwork.html">Explore artwork →</a>',
      );
  } catch {
    root.innerHTML =
      "<p>Forge inventory could not be loaded. Retry from My Vault; nothing has been consumed.</p>";
  }
}
window.addEventListener("studio:collection-saved", () => {
  if (!document.querySelector("#vault-panel-forge")?.hidden) loadForge();
});
