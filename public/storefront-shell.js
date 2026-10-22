// Account counts are private and server-derived. No invented Vault balance is shown.
async function refreshVaultCount(client) {
  const labels = document.querySelectorAll("[data-vault-count]");
  if (!labels.length) return;
  try {
    const { data } = await client.supabase.auth.getSession();
    if (!data.session) {
      labels.forEach((el) => {
        el.hidden = true;
        el.textContent = "";
      });
      return;
    }
    const result = await client.invoke(
      "mint-access",
      { action: "vault_count" },
      data.session.access_token,
    );
    if (!Number.isSafeInteger(result.count) || result.count < 0) throw Error();
    labels.forEach((el) => {
      el.textContent = ` (${result.count})`;
      el.hidden = false;
    });
  } catch {
    labels.forEach((el) => (el.hidden = true));
  }
}
// Defer the SDK until a signed-in session exists on this browser.
try {
  const project = new URL((await import("./config.js")).SUPABASE_URL).hostname.split(".")[0];
  if (
    localStorage.getItem(`sb-${project}-auth-token`) ||
    location.pathname === "/collection.html"
  ) {
    const client = await import("./supabase-client.js");
    refreshVaultCount(client);
    client.supabase.auth.onAuthStateChange?.(() => setTimeout(() => refreshVaultCount(client), 0));
    window.addEventListener("studio:collection-saved", () => refreshVaultCount(client));
  }
} catch {}
