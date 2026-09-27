// SECTION: Public customer messages
import { supabase } from "./supabase-client.js";

const form = document.querySelector("#contact-form");
const status = document.querySelector("#contact-message");

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = form.querySelector("button");
  const values = Object.fromEntries(new FormData(form));
  button.disabled = true;
  status.classList.remove("success");
  status.textContent = "Sending…";
  try {
    const { data, error } = await supabase.functions.invoke("submit-message", { body: values });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    form.reset();
    status.classList.add("success");
    status.textContent = "Your message was sent. Pixel Shroom Studio will reply by email.";
  } catch (error) {
    status.textContent = error.message || "Your message could not be sent. Please email the studio directly.";
  } finally {
    button.disabled = false;
  }
});
