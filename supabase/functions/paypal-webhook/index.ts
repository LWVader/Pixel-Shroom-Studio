import { json, service } from "../_shared/common.ts";
Deno.serve(async (request) => {
  try {
    const event = await request.json(), client = Deno.env.get("PAYPAL_CLIENT_ID")!, secret = Deno.env.get("PAYPAL_CLIENT_SECRET")!, base = Deno.env.get("PAYPAL_ENV") === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
    const tokenResponse = await fetch(`${base}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${btoa(`${client}:${secret}`)}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
    const token = await tokenResponse.json();
    const verification = await fetch(`${base}/v1/notifications/verify-webhook-signature`, { method: "POST", headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ auth_algo: request.headers.get("paypal-auth-algo"), cert_url: request.headers.get("paypal-cert-url"), transmission_id: request.headers.get("paypal-transmission-id"), transmission_sig: request.headers.get("paypal-transmission-sig"), transmission_time: request.headers.get("paypal-transmission-time"), webhook_id: Deno.env.get("PAYPAL_WEBHOOK_ID"), webhook_event: event }) });
    const verified = await verification.json(); if (verified.verification_status !== "SUCCESS") return json({ error: "Invalid webhook." }, 400);
    const db = service(), { error: duplicate } = await db.from("webhook_events").insert({ provider: "paypal", event_id: event.id });
    if (duplicate?.code === "23505") return json({ received: true }); if (duplicate) throw duplicate;
    if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
      const providerOrderId = event.resource?.supplementary_data?.related_ids?.order_id;
      const { data: order } = await db.from("orders").select("id,amount,artworks(category)").eq("provider_order_id", providerOrderId).single();
      if (order && Number(event.resource?.amount?.value) === Number(order.amount) && event.resource?.amount?.currency_code === "USD") {
        await db.from("orders").update({ status: "paid", paid_at: new Date().toISOString(), fulfillment_status: order.artworks?.category === "NFT" ? "email_pending" : "ready" }).eq("id", order.id).eq("status", "pending");
        if (order.artworks?.category !== "NFT") await db.from("licenses").upsert({ order_id: order.id, expires_at: new Date(Date.now() + 86400000).toISOString(), download_limit: 3 });
      }
    }
    return json({ received: true });
  } catch (error) { console.error(error); return json({ error: "Webhook failed." }, 400); }
});

