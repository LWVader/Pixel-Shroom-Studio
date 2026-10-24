import { loadForge } from "./vault-forge.js?v=20261022-loop";
const buttons = [...document.querySelectorAll("[data-vault-tab]")];
function openTab(name) {
  if (!["artwork", "forge", "print", "orders", "selling", "account"].includes(name))
    name = "artwork";
  buttons.forEach((b) => {
    const active = b.dataset.vaultTab === name;
    b.setAttribute("aria-pressed", String(active));
  });
  document
    .querySelectorAll("[data-vault-panel]")
    .forEach((p) => (p.hidden = p.dataset.vaultPanel !== name));
  const u = new URL(location.href);
  u.searchParams.set("tab", name);
  history.replaceState(null, "", u);
  if (name === "forge") loadForge();
  if (name === "orders") window.dispatchEvent(new Event("studio:orders-requested"));
  if (name === "print") window.dispatchEvent(new Event("studio:prints-requested"));
}
buttons.forEach((b) => b.addEventListener("click", () => openTab(b.dataset.vaultTab)));
if (buttons.length) openTab(new URLSearchParams(location.search).get("tab") || "artwork");
