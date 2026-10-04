// SECTION: Public customer messages
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config.js";

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
    const response = await fetch(`${SUPABASE_URL}/functions/v1/submit-message`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(values),
      signal: AbortSignal.timeout(20000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    form.reset();
    status.classList.add("success");
    status.textContent = "Your message was sent. Pixel Shroom Studio will reply by email.";
  } catch (error) {
    status.textContent =
      error.message || "Your message could not be sent. Please email the studio directly.";
  } finally {
    button.disabled = false;
  }
});
