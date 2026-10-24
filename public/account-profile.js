import { supabase } from "./supabase-client.js";
export const SHIPPING_FIELDS = [
  "firstName",
  "lastName",
  "addressLine1",
  "addressLine2",
  "city",
  "state",
  "postCode",
  "phone",
];
export function shippingRecipient(form) {
  const recipient = Object.fromEntries(
    SHIPPING_FIELDS.map((key) => [key, form.elements[key].value.trim()]),
  );
  recipient.state = recipient.state.toUpperCase();
  recipient.country = "US";
  return recipient;
}
export async function getShippingProfile(userId) {
  const { data, error } = await supabase
    .from("vault_profiles")
    .select("recipient")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.recipient || null;
}
export function fillShipping(form, recipient) {
  for (const key of SHIPPING_FIELDS)
    if (form.elements[key]) form.elements[key].value = recipient?.[key] || "";
}
export function setupAccountProfile() {
  const form = document.querySelector("#vault-shipping-form");
  if (!form) return;
  const panel = document.querySelector("#account-signed-in");
  const status = document.querySelector("#account-status");
  const email = document.querySelector("#account-email");
  let activeUser = null,
    revision = 0;
  async function refresh() {
    const request = ++revision;
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    panel.hidden = !user;
    if (activeUser !== user?.id) {
      form.reset();
      email.textContent = "";
      status.textContent = "";
    }
    activeUser = user?.id || null;
    if (!user) {
      status.textContent = "Sign in or create an account above to save delivery details.";
      return;
    }
    email.textContent = user.email || "";
    try {
      const recipient = await getShippingProfile(user.id);
      if (request !== revision || activeUser !== user.id) return;
      fillShipping(form, recipient);
      status.textContent = recipient
        ? "Your saved US delivery address is ready for canvas orders."
        : "Save a US delivery address whenever you are ready to print.";
    } catch {
      if (request === revision)
        status.textContent =
          "Shipping details could not be loaded. Retry after the account migration is deployed.";
    }
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const button = event.submitter;
    button.disabled = true;
    try {
      const { data, error: authError } = await supabase.auth.getUser();
      if (authError || !data.user) throw Error("Sign in to save your delivery address.");
      const recipient = shippingRecipient(form);
      const { error } = await supabase
        .from("vault_profiles")
        .upsert({ user_id: data.user.id, recipient, updated_at: new Date().toISOString() });
      if (error) throw error;
      if (activeUser === data.user.id)
        status.textContent =
          "Delivery address saved. You can review or change it before each canvas order.";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  document.querySelector("#remove-shipping").onclick = async () => {
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user) throw Error("Sign in first.");
      const { error } = await supabase.from("vault_profiles").delete().eq("user_id", data.user.id);
      if (error) throw error;
      form.reset();
      status.textContent =
        "Saved address removed. Existing order delivery details stay with their orders.";
    } catch (error) {
      status.textContent = error.message;
    }
  };
  document.querySelector("#account-reset-password").onclick = async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user?.email) throw Error("Sign in first.");
      const { error } = await supabase.auth.resetPasswordForEmail(data.user.email, {
        redirectTo: location.origin + "/collection.html?recovery=1",
      });
      if (error) throw error;
      status.textContent = "Password-reset email requested. Check your inbox.";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
  refresh().catch(() => {});
  supabase.auth.onAuthStateChange((event) => {
    if (event !== "TOKEN_REFRESHED") setTimeout(() => refresh().catch(() => {}), 0);
  });
}
