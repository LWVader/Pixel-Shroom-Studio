import {campaignApi, wireCheckout} from "./studio.js";

const title = document.querySelector("#brief-title");
const status = document.querySelector("#brief-status");
const form = document.querySelector("#brief-form");
const sessionId = new URL(location.href).searchParams.get("session_id");
const surprise = form.elements.surprise;
surprise.addEventListener("change", () => {
  form.elements.colors.disabled = surprise.checked;
});

function showThanks(order) {
  form.hidden = true;
  title.textContent = "Brief received.";
  status.textContent = order.offer === "monthly"
    ? "Your Monthly Asset Pack brief is in. I’ll send each finished ZIP from weirichloren@gmail.com to the email address you used at checkout."
    : "Your Attention Pack brief is in. I’ll send the finished ZIP from weirichloren@gmail.com to the email address you used at checkout.";
  if (order.canAddLanding) {
    const panel = document.querySelector("#addon-panel");
    const confirm = panel.querySelector("#addon-confirm");
    const button = panel.querySelector("[data-checkout]");
    panel.hidden = false;
    confirm.addEventListener("change", () => { button.disabled = !confirm.checked; });
    wireCheckout(button, panel.querySelector("#addon-status"), {parentSession: sessionId});
  }
}

async function verifyOrder() {
  if (!sessionId) {
    title.textContent = "Find your order.";
    status.textContent = "Open the page Stripe returned you to after payment, or email the studio with your receipt number.";
    return;
  }
  try {
    const order = await campaignApi("order", {sessionId});
    if (order.offer === "landing") {
      title.textContent = "Landing page added.";
      status.textContent = "Your payment is confirmed. We’ll follow up by email using the details from your original campaign brief.";
    } else if (order.submitted) {
      showThanks(order);
    } else {
      title.textContent = "Set the vibe.";
      status.textContent = "Payment confirmed. Tell us what your campaign needs.";
      form.hidden = false;
    }
  } catch (error) {
    title.textContent = "Checking your order.";
    status.textContent = error.message;
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = event.submitter;
  const formStatus = document.querySelector("#form-status");
  submit.disabled = true;
  formStatus.textContent = "Sending your brief…";
  const brief = Object.fromEntries(new FormData(form));
  if (surprise.checked) brief.colors = "Surprise me";
  try {
    showThanks(await campaignApi("brief", {sessionId, brief}));
  } catch (error) {
    formStatus.textContent = error.message;
    submit.disabled = false;
  }
});

verifyOrder();
