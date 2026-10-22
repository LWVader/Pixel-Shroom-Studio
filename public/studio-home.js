import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { validRows } from "./catalog-core.js?v=20261022-loop";
import {
  renderFeatured,
  renderProductExamples,
  renderProjectExample,
  renderFeedback,
} from "./studio-home-core.js?v=20261022-loop";
export function updateArtworkFeatures(rows) {
  const featured = document.querySelector("#featured-artwork"),
    project = document.querySelector("#creative-project-preview");
  if (featured) {
    featured.innerHTML = renderFeatured(rows);
    featured.closest("section").hidden = rows.length === 0;
  }
  if (project) project.innerHTML = renderProjectExample(rows);
}
const bootstrap = document.querySelector("#catalog-bootstrap");
if (bootstrap) {
  try {
    updateArtworkFeatures(validRows(JSON.parse(bootstrap.textContent).rows));
  } catch {}
}
async function loadProducts() {
  const examples = document.querySelector("#product-examples");
  if (!examples) return;
  try {
    const response = await fetch("/api/print-products", {
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error();
    examples.innerHTML = renderProductExamples(await response.json());
  } catch {
    examples.innerHTML = renderProductExamples(null);
  }
}
async function loadFeedback() {
  const section = document.querySelector("#customer-feedback"),
    quotes = document.querySelector("#customer-quotes");
  if (!section || !quotes) return;
  try {
    const response = await fetch("/studio-feedback.json", { signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw new Error();
    quotes.innerHTML = renderFeedback(await response.json());
    section.hidden = !quotes.childElementCount;
  } catch {
    section.hidden = true;
    quotes.replaceChildren();
  }
}
const form = document.querySelector("#studio-updates-form"),
  status = document.querySelector("#updates-status");
if (form && new URLSearchParams(location.search).get("updates") === "nft") {
  form.elements.studio.checked = false;
  form.elements.nft.checked = true;
}
form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const values = new FormData(form),
    button = form.querySelector("button[type=submit]");
  const topics = [
    values.has("studio") ? "studio artwork and product updates" : null,
    values.has("nft") ? "NFT release notifications" : null,
  ].filter(Boolean);
  if (!topics.length) {
    status.textContent = "Choose at least one type of update.";
    return;
  }
  if (!values.has("consent")) {
    status.textContent = "Please agree to receive the updates you choose.";
    return;
  }
  button.disabled = true;
  status.textContent = "Saving your request…";
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/submit-message`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: String(values.get("name")).trim(),
        email: String(values.get("email")).trim(),
        subject:
          topics.length === 1 && values.has("nft")
            ? "NFT release notification opt-in"
            : "Studio updates opt-in",
        message: `I consent to receive ${topics.join(" and ")} by email from Pixel Shroom Studio. I understand I can unsubscribe by replying to any update or contacting the studio. Consent text version: 2026-10-14.`,
        website: values.get("website") || "",
      }),
      signal: AbortSignal.timeout(20000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.sent !== true) throw new Error();
    form.reset();
    status.textContent =
      "Your signup request has been saved. The studio will manage your chosen updates by email.";
  } catch {
    status.textContent = "We couldn’t save your request. Please try again or use the contact form.";
  } finally {
    button.disabled = false;
  }
});
Promise.allSettled([loadProducts(), loadFeedback()]);
