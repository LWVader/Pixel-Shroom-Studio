import Stripe from "npm:stripe@18";
import { json, service } from "../_shared/common.ts";
Deno.serve(async (request) => {
  try {
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);
    const event = await stripe.webhooks.constructEventAsync(await request.text(), request.headers.get("stripe-signature") || "", Deno.env.get("STRIPE_WEBHOOK_SECRET")!);
    const db = service(), { error: duplicate } = await db.from("webhook_events").insert({ provider: "stripe", event_id: event.id });
    if (duplicate?.code === "23505") return json({ received: true });
    if (duplicate) throw duplicate;
    if (["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status === "paid" && session.metadata?.order_id) {
        const { data: order } = await db.from("orders").select("id,artwork_id,artworks(category)").eq("id", session.metadata.order_id).eq("provider_order_id", session.id).single();
        if (order) {
          await db.from("orders").update({ status: "paid", paid_at: new Date().toISOString(), buyer_email: session.customer_details?.email || null, fulfillment_status: order.artworks?.category === "NFT" ? "email_pending" : "ready" }).eq("id", order.id).eq("status", "pending");
          if (order.artworks?.category !== "NFT") await db.from("licenses").upsert({ order_id: order.id, expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), download_limit: 3 });
        }
      }
    }
    return json({ received: true });
  } catch (error) { console.error(error); return json({ error: "Invalid webhook." }, 400); }
});

