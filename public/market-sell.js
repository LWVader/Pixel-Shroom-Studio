import { invoke } from "./supabase-client.js";
import { feeBreakdown, marketMoney, connectRedirectUrl } from "./market-core.js";
export function setupMarketSelling({ getSession, showStatus }) {
  const dialog = document.querySelector("#sell-dialog"),
    form = document.querySelector("#sell-form"),
    summary = document.querySelector("#sell-summary"),
    listings = document.querySelector("#my-market-listings"),
    sellerStatus = document.querySelector("#seller-status");
  if (!dialog) return { open: () => {} };
  let mintId;
  const call = async (body) => {
    const session = getSession();
    if (!session) throw new Error("Sign in first.");
    return invoke("market-api", body, session.access_token);
  };
  function quote() {
    try {
      const quote = feeBreakdown(Math.round(Number(form.elements.price.value) * 100));
      summary.textContent = `Price: ${marketMoney(quote.price)} · Platform fee (10%): −${marketMoney(quote.fee)} · Seller proceeds: ${marketMoney(quote.seller)}. The platform pays Stripe processing fees from its share. Taxes or other adjustments may apply.`;
    } catch (error) {
      summary.textContent = error.message;
    }
  }
  form.elements.price.oninput = quote;
  document.querySelector("#sell-close").onclick = () => dialog.close();
  document.querySelector("#connect-seller").onclick = async () => {
    try {
      const result = await call({ action: "onboard" });
      location.assign(connectRedirectUrl(result.url));
    } catch (error) {
      sellerStatus.textContent = error.message;
    }
  };
  document.querySelector("#seller-dashboard").onclick = async () => {
    try {
      const result = await call({ action: "seller_dashboard" });
      location.assign(connectRedirectUrl(result.url));
    } catch (error) {
      sellerStatus.textContent = error.message;
    }
  };
  async function refresh() {
    try {
      const result = await call({ action: "seller_status" });
      sellerStatus.textContent = result.ready
        ? "Seller account is ready for listings and payouts."
        : "Finish Stripe onboarding before listing. Returning from Stripe alone does not confirm eligibility.";
      return result;
    } catch (error) {
      sellerStatus.textContent = error.message;
      return null;
    }
  }
  document.querySelector("#refresh-seller").onclick = refresh;
  document.querySelector("#show-sale-listings").onclick = async () => {
    try {
      const result = await call({ action: "mine" });
      listings.replaceChildren();
      for (const item of result.items) {
        const row = document.createElement("p");
        row.textContent = `${item.id} · ${marketMoney(item.price_cents)} · ${item.status} `;
        if (["active", "preparing"].includes(item.status)) {
          const button = document.createElement("button");
          button.className = "button";
          button.textContent = "Cancel listing";
          button.onclick = async () => {
            try {
              await call({ action: "cancel", listingId: item.id });
              row.textContent = "Listing cancelled.";
            } catch (error) {
              sellerStatus.textContent = error.message;
            }
          };
          row.append(button);
        }
        listings.append(row);
      }
      if (!result.items.length) listings.textContent = "No open sale listings.";
    } catch (error) {
      sellerStatus.textContent = error.message;
    }
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const quote = feeBreakdown(Math.round(Number(form.elements.price.value) * 100));
      await call({ action: "list", mintId, priceCents: quote.price });
      dialog.close();
      showStatus(
        "Your listing is preparing its protected variant preview. It becomes available after processing. Open your sale listings to check progress.",
      );
    } catch (error) {
      summary.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
  return {
    refresh,
    open: async (id) => {
      const state = await refresh();
      if (!state?.ready) {
        showStatus("Complete seller onboarding using the selling controls below.");
        return;
      }
      mintId = id;
      form.reset();
      quote();
      dialog.showModal();
    },
  };
}
