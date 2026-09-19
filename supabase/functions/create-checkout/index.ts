import Stripe from "npm:stripe@18";
import { cors, json, randomToken, service, sha256 } from "../_shared/common.ts";
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { artworkId, provider, buyerEmail = "" } = await request.json();
    if (!["stripe", "paypal"].includes(provider)) return json({ error: "Invalid payment provider." }, 400);
    const db = service(), { data: artwork, error } = await db.from("artworks").select("id,title,price,category").eq("id", artworkId).eq("status", "published").single();
    if (error || !artwork) return json({ error: "Artwork is unavailable." }, 404);
    const access = randomToken(), { data: order, error: orderError } = await db.from("orders").insert({ artwork_id: artwork.id, provider, amount: artwork.price, buyer_email: buyerEmail || null, access_token_hash: await sha256(access), fulfillment_status: artwork.category === "NFT" ? "email_pending" : "pending" }).select("id").single();
    if (orderError) throw orderError;
    const site = Deno.env.get("SITE_URL")!.replace(/\/$/, ""), success = `${site}/checkout-success.html?order=${order.id}&access=${encodeURIComponent(access)}&provider=${provider}`;
    if (provider === "stripe") {
      const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);
      const session = await stripe.checkout.sessions.create({ mode: "payment", success_url: `${success}&session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${site}/checkout-cancel.html?order=${order.id}`, customer_email: buyerEmail || undefined, metadata: { order_id: order.id }, line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: Math.round(Number(artwork.price) * 100), product_data: { name: artwork.title } } }] });
      await db.from("orders").update({ provider_order_id: session.id }).eq("id", order.id); return json({ checkoutUrl: session.url });
    }
    const client = Deno.env.get("PAYPAL_CLIENT_ID")!, secret = Deno.env.get("PAYPAL_CLIENT_SECRET")!, base = Deno.env.get("PAYPAL_ENV") === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
    const tokenResponse = await fetch(`${base}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${btoa(`${client}:${secret}`)}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
    const token = await tokenResponse.json(); if (!tokenResponse.ok) throw new Error("PayPal authentication failed.");
    const paypalResponse = await fetch(`${base}/v2/checkout/orders`, { method: "POST", headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json", "PayPal-Request-Id": order.id }, body: JSON.stringify({ intent: "CAPTURE", purchase_units: [{ custom_id: order.id, amount: { currency_code: "USD", value: Number(artwork.price).toFixed(2) } }], payment_source: { paypal: { experience_context: { user_action: "PAY_NOW", return_url: success, cancel_url: `${site}/checkout-cancel.html?order=${order.id}` } } } }) });
    const paypal = await paypalResponse.json(); if (!paypalResponse.ok) throw new Error(paypal.message || "PayPal checkout failed.");
    await db.from("orders").update({ provider_order_id: paypal.id }).eq("id", order.id); return json({ checkoutUrl: paypal.links.find((link: { rel: string }) => ["payer-action", "approve"].includes(link.rel))?.href });
  } catch (error) { console.error(error); return json({ error: error instanceof Error ? error.message : "Checkout failed." }, 500); }
});
