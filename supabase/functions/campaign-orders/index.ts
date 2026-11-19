import Stripe from "npm:stripe@18";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createCampaignOrders } from "./orders.mjs";

const env = (name: string): string => Deno.env.get(name) ?? "";
const source = env("CAMPAIGN_SITE_URL") || "https://www.pixelshroomstudio.com";
const stripeKey = env("STRIPE_SECRET_KEY");
const billingPortal = env("CAMPAIGN_BILLING_PORTAL_URL");
const recipient = env("ADMIN_ALERT_EMAIL") || "lwvader@pixelshroomstudio.com";

function isBillingUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "billing.stripe.com";
  } catch {
    return false;
  }
}

async function authorized(request: Request) {
  const expected = env("CAMPAIGN_PROXY_KEY");
  const supplied = request.headers.get("X-Campaign-Proxy-Key") || "";
  if (expected.length < 32 || supplied.length !== expected.length) return false;
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all(
    [expected, supplied].map((value) => crypto.subtle.digest("SHA-256", encoder.encode(value)))
  );
  const first = new Uint8Array(left);
  const second = new Uint8Array(right);
  let difference = 0;
  for (let index = 0; index < first.length; index += 1) difference |= first[index] ^ second[index];
  return difference === 0;
}

function json(body: unknown, status = 200) {
  return Response.json(body, {status, headers: {"Cache-Control": "no-store"}});
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== "POST") return json({error: "Method not allowed."}, 405);
  if (!await authorized(request)) return json({error: "Checkout is temporarily unavailable."}, 503);
  try {
    const raw = await request.text();
    if (raw.length > 12000) return json({error: "This request is too large."}, 413);
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      return json({error: "This request could not be read."}, 400);
    }
    const portal = isBillingUrl(billingPortal) ? billingPortal : "";
    const options = {
      attention: Boolean(stripeKey && env("CAMPAIGN_ATTENTION_ENABLED") === "true"),
      landing: Boolean(stripeKey && env("CAMPAIGN_LANDING_ENABLED") === "true"),
      monthlyPrice: stripeKey && portal ? env("CAMPAIGN_MONTHLY_PRICE_ID") : "",
      billingPortal: portal,
      site: new URL(source).origin
    };
    if (input?.action === "offers") {
      return json({attention: options.attention, monthly: Boolean(options.monthlyPrice), billingPortal: portal});
    }
    if (!stripeKey) return json({error: "Checkout is temporarily unavailable."}, 503);

    const stripe = new Stripe(stripeKey, {httpClient: Stripe.createFetchHttpClient()});
    const database = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: {persistSession: false, autoRefreshToken: false}
    });
    const table = () => database.from("campaign_briefs");
    const store = {
      async get(id: string) {
        const {data, error} = await table()
          .select("landing_session_id,landing_paid_at").eq("checkout_session_id", id).maybeSingle();
        if (error) throw error;
        return data;
      },
      async save(record: Record<string, string>) {
        const {data, error} = await table().upsert(record, {
          onConflict: "checkout_session_id", ignoreDuplicates: true
        }).select("checkout_session_id");
        if (error) throw error;
        return Boolean(data?.length);
      },
      async setLanding(parent: string, landing: string) {
        const {data, error} = await table().update({landing_session_id: landing})
          .eq("checkout_session_id", parent).is("landing_session_id", null).select("checkout_session_id");
        if (error) throw error;
        if (!data?.length && (await store.get(parent))?.landing_session_id !== landing) {
          throw new Error("Landing checkout association changed.");
        }
      },
      async markLandingPaid(parent: string, landing: string) {
        const {error} = await table().update({landing_paid_at: new Date().toISOString()})
          .eq("checkout_session_id", parent).eq("landing_session_id", landing)
          .is("landing_paid_at", null);
        if (error) throw error;
      }
    };
    async function notify(record: Record<string, string>) {
      const resendKey = env("RESEND_API_KEY");
      const from = env("RESEND_FROM_EMAIL");
      if (!resendKey || !from) return;
      const notice = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json"},
        body: JSON.stringify({
          from,
          to: [recipient],
          reply_to: record.buyer_email,
          subject: "New Pixel Shroom Studio campaign brief",
          text: `Offer: ${record.offer}\nBusiness: ${record.business}\nIndustry: ${record.industry}\nVibe: ${record.vibe}\nColors: ${record.colors || "No preference"}\n\nCampaign goal\n${record.goal}`
        })
      });
      if (!notice.ok) throw new Error("Email notification rejected.");
    }

    return json(await createCampaignOrders({stripe, store, options, notify})(input));
  } catch (cause) {
    const issue = cause as {error?: string; status?: number};
    if (issue?.error && typeof issue.status === "number") return json({error: issue.error}, issue.status);
    console.error("Campaign orders request failed.");
    return json({error: "Your request could not be completed. Try again or email the studio for help."}, 503);
  }
});
