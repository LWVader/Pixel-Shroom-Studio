import { json, service } from "../_shared/common.ts";
Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, request);
  try {
    const event = await request.json();
    const client = Deno.env.get("PAYPAL_CLIENT_ID"), secret = Deno.env.get("PAYPAL_CLIENT_SECRET"), webhookId = Deno.env.get("PAYPAL_WEBHOOK_ID");
    if (!client || !secret || !webhookId) throw new Error("PayPal webhook is not configured.");
    const base = Deno.env.get("PAYPAL_ENV") === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
    const tokenResponse = await fetch(`${base}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${btoa(`${client}:${secret}`)}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
    const token = await tokenResponse.json();
    if (!tokenResponse.ok || !token.access_token) throw new Error("PayPal authentication is unavailable.");
    const verification = await fetch(`${base}/v1/notifications/verify-webhook-signature`, { method: "POST", headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ auth_algo: request.headers.get("paypal-auth-algo"), cert_url: request.headers.get("paypal-cert-url"), transmission_id: request.headers.get("paypal-transmission-id"), transmission_sig: request.headers.get("paypal-transmission-sig"), transmission_time: request.headers.get("paypal-transmission-time"), webhook_id: webhookId, webhook_event: event }) });
    const verified = await verification.json();
    if (!verification.ok) throw new Error("PayPal webhook verification is unavailable.");
    if (verified.verification_status !== "SUCCESS") return json({ error: "Invalid webhook signature." }, 400, request);
    if (event.event_type !== "PAYMENT.CAPTURE.COMPLETED") return json({ received: true, ignored: true }, 200, request);
    const reference = event.resource?.supplementary_data?.related_ids?.order_id;
    if (!event.id || !reference || event.resource?.status !== "COMPLETED") throw new Error("Payment capture is incomplete.");
    const database = service();
    const { data: order, error: lookupError } = await database.from("orders").select("id").eq("provider", "paypal").eq("provider_order_id", reference).single();
    if (lookupError || !order) throw new Error("Payment order was not found.");
    // Event receipt, paid state and license creation commit together or all roll back.
    const { data, error } = await database.rpc("fulfill_verified_order", { payment_provider: "paypal", payment_event_id: event.id, provider_reference: reference, local_order_id: order.id, paid_amount: event.resource.amount?.value, paid_currency: event.resource.amount?.currency_code, customer_email: null });
    if (error) throw error;
    return json({ received: true, ...data }, 200, request);
  } catch (error) {
    console.error("PayPal webhook fulfillment failed:", error);
    return json({ error: "Webhook processing failed." }, 500, request);
  }
});
