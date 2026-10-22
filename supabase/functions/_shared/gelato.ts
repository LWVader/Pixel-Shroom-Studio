import { service } from "./common.ts";
import { orderPayload, quotePayload, shippingOptions } from "./gelato-core.ts";
export const PRINT_BUCKET = "gelato-print-files";
export function printMode() {
  return Deno.env.get("GELATO_MODE") === "live" ? "live" : "sandbox";
}
export function livePrintsAllowed() {
  return printMode() === "live" && Deno.env.get("GELATO_LIVE_ENABLED") === "true";
}
export function printsEnabled() {
  return (
    Deno.env.get("GELATO_CHECKOUT_ENABLED") === "true" &&
    Boolean(Deno.env.get("GELATO_API_KEY")) &&
    (printMode() === "sandbox" || livePrintsAllowed())
  );
}
export async function gelatoRequest(path: string, body?: unknown) {
  const key = Deno.env.get("GELATO_API_KEY");
  if (!key) throw new Error("Gelato is not configured.");
  const response = await fetch("https://order.gelatoapis.com/v4/" + path, {
    method: body ? "POST" : "GET",
    headers: { "X-API-KEY": key, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new Error("Gelato could not complete this request. Contact the studio if it persists.");
  return response.json();
}
export async function privatePrintUrl(db: any, path: string) {
  if (!/^gelato\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg|pdf)$/.test(path))
    throw new Error("Invalid private print mapping.");
  const { data, error } = await db.storage.from(PRINT_BUCKET).createSignedUrl(path, 604800);
  if (error || !data?.signedUrl) throw new Error("Print source unavailable.");
  return data.signedUrl;
}
export async function submitPaidPrint(db: any, id: string) {
  const { data: order, error } = await db.rpc("claim_gelato_submission", { target_order: id });
  if (error) throw error;
  if (!order) return;
  try {
    const url = await privatePrintUrl(db, order.product_snapshot.print_path);
    const refreshed = shippingOptions(
      await gelatoRequest(
        "orders:quote",
        quotePayload(
          order.id,
          order.owner_id,
          order.product_snapshot,
          order.quantity,
          order.recipient,
          url,
        ),
      ),
      order.product_snapshot,
      order.quantity,
    );
    if (
      !refreshed.some(
        (option: any) =>
          option.uid === order.shipment_method_uid &&
          option.cents <=
            (order.product_snapshot.providerShipping?.[option.uid] ?? order.shipping_cents),
      )
    )
      throw new Error("Delivery quote changed; studio review required.");
    const payload = orderPayload(order, url, livePrintsAllowed());
    const response = await gelatoRequest("orders", payload);
    if (!response?.id || response.orderReferenceId !== order.id)
      throw new Error("Gelato submission requires reconciliation.");
    const { error: saveError } = await db
      .from("gelato_orders")
      .update({
        gelato_id: response.id,
        gelato_status: String(response.fulfillmentStatus || "received"),
        fulfillment_state: "accepted",
      })
      .eq("id", id)
      .eq("fulfillment_state", "submitting");
    if (saveError) throw saveError;
  } catch {
    // Never blindly repeat a create request: the provider may have accepted it before a timeout.
    await db
      .from("gelato_orders")
      .update({
        fulfillment_state: "needs_review",
        review_reason: "Check Gelato by order reference before any further submission.",
      })
      .eq("id", id)
      .eq("fulfillment_state", "submitting");
  }
}
export async function completePrintSession(db: any, session: any, eventId: string) {
  if (session.payment_status !== "paid") return;
  const subtotal = session.amount_subtotal + (session.total_details?.amount_shipping || 0);
  if (
    !session.metadata?.print_order_id ||
    !Number.isInteger(subtotal) ||
    session.amount_total < subtotal
  )
    throw new Error("Invalid print payment.");
  if (session.livemode && session.automatic_tax?.status !== "complete")
    throw new Error("Print tax calculation is incomplete.");
  const { error } = await db.rpc("claim_gelato_payment", {
    target_order: session.metadata.print_order_id,
    session_id: session.id,
    event_key: eventId,
    subtotal,
    currency_code: session.currency,
    is_live: session.livemode,
    intent:
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id || null,
  });
  if (error) throw error;
  await submitPaidPrint(db, session.metadata.print_order_id);
}
export async function handlePrintProblem(db: any, event: any) {
  const value = event.data.object;
  const intent =
    typeof value.payment_intent === "string" ? value.payment_intent : value.payment_intent?.id;
  if (!intent) return;
  // Refunds/disputes need operator review; printing cannot always be recalled once production starts.
  const { error } = await db
    .from("gelato_orders")
    .update({
      payment_state: event.type.includes("dispute") ? "disputed" : "refunded",
      fulfillment_state: "needs_review",
      review_reason:
        "Payment reversal or dispute: review production/cancellation and customer support.",
    })
    .eq("stripe_payment_intent", intent);
  if (error) throw error;
}
export async function refreshPrintOrder(db: any, order: any) {
  let id = order.gelato_id;
  if (!id) {
    if (!["submitting", "needs_review"].includes(order.fulfillment_state)) return order;
    const search = await gelatoRequest("orders:search", { orderReferenceId: order.id, limit: 100 });
    const matches = (search.orders || []).filter(
      (o: any) => o.orderReferenceId === order.id && o.customerReferenceId === order.owner_id,
    );
    if (matches.length !== 1) return order;
    id = matches[0].id;
  }
  const current = await gelatoRequest("orders/" + encodeURIComponent(id));
  if (current.orderReferenceId !== order.id || current.customerReferenceId !== order.owner_id)
    throw new Error("Order reconciliation mismatch.");
  const tracking = (current.shipment?.packages || []).map((p: any) => {
    let url = "";
    try {
      const u = new URL(p.trackingUrl);
      if (u.protocol === "https:") url = u.href;
    } catch {}
    return { code: String(p.trackingCode || "").slice(0, 100), url };
  });
  const update = {
    gelato_id: id,
    gelato_status: String(current.fulfillmentStatus || "received"),
    tracking,
    ...(order.payment_state === "paid" ? { fulfillment_state: "accepted" } : {}),
  };
  const { error } = await db.from("gelato_orders").update(update).eq("id", order.id);
  if (error) throw error;
  return { ...order, ...update };
}
