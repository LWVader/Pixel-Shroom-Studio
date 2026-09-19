import { cors, json, service, sha256 } from "../_shared/common.ts";
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { orderId, accessToken, paypalOrderId } = await request.json(), db = service();
    const { data: order } = await db.from("orders").select("id,provider_order_id,access_token_hash,status").eq("id", orderId).eq("provider", "paypal").single();
    if (!order || order.access_token_hash !== await sha256(accessToken) || order.provider_order_id !== paypalOrderId) return json({ error: "Invalid order access." }, 403);
    if (order.status === "paid") return json({ captured: true });
    const client = Deno.env.get("PAYPAL_CLIENT_ID")!, secret = Deno.env.get("PAYPAL_CLIENT_SECRET")!, base = Deno.env.get("PAYPAL_ENV") === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
    const tokenResponse = await fetch(`${base}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${btoa(`${client}:${secret}`)}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
    const token = await tokenResponse.json();
    const capture = await fetch(`${base}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, { method: "POST", headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json", "PayPal-Request-Id": `capture-${order.id}` } });
    if (!capture.ok && capture.status !== 422) return json({ error: "PayPal capture failed." }, 502);
    return json({ captured: true });
  } catch { return json({ error: "PayPal capture failed." }, 500); }
});

