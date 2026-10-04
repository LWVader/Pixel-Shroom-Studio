import { corsFor, json, service, sha256 } from "../_shared/common.ts";
Deno.serve(async (request) => {
  const respond = (data: unknown, status = 200) => json(data, status, request);
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsFor(request) });
  if (request.method !== "POST") return respond({ error: "Method not allowed." }, 405);
  try {
    const { orderId, accessToken, paypalOrderId } = await request.json(),
      db = service();
    if (!orderId || typeof accessToken !== "string" || !accessToken || !paypalOrderId)
      return respond({ error: "Order credentials are required." }, 400);
    const { data: order } = await db
      .from("orders")
      .select("id,provider_order_id,access_token_hash,status")
      .eq("id", orderId)
      .eq("provider", "paypal")
      .single();
    if (
      !order ||
      order.access_token_hash !== (await sha256(accessToken)) ||
      order.provider_order_id !== paypalOrderId
    )
      return respond({ error: "Invalid order access." }, 403);
    if (order.status === "paid") return respond({ captured: true });
    const client = Deno.env.get("PAYPAL_CLIENT_ID")!,
      secret = Deno.env.get("PAYPAL_CLIENT_SECRET")!,
      base =
        Deno.env.get("PAYPAL_ENV") === "live"
          ? "https://api-m.paypal.com"
          : "https://api-m.sandbox.paypal.com";
    const tokenResponse = await fetch(`${base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${client}:${secret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const token = await tokenResponse.json();
    const capture = await fetch(
      `${base}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          "Content-Type": "application/json",
          "PayPal-Request-Id": `capture-${order.id}`,
        },
      },
    );
    const captured = await capture.json().catch(() => ({}));
    const alreadyCaptured =
      capture.status === 422 &&
      captured.details?.some(
        (detail: { issue?: string }) => detail.issue === "ORDER_ALREADY_CAPTURED",
      );
    if (!capture.ok && !alreadyCaptured) return respond({ error: "PayPal capture failed." }, 502);
    return respond({ captured: true });
  } catch {
    return respond({ error: "PayPal capture failed." }, 500);
  }
});
