import Stripe from "npm:stripe@18";
import { service } from "./common.ts";
export function marketStripe() {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) throw new Error("Stripe unavailable");
  return new Stripe(key, { timeout: 15000, maxNetworkRetries: 1 });
}
export async function syncMarketSeller(
  db: ReturnType<typeof service>,
  stripe: Stripe,
  userId: string,
) {
  const { data: seller, error } = await db
    .from("market_sellers")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!seller?.stripe_account_id) return seller;
  const account = await stripe.accounts.retrieve(seller.stripe_account_id);
  if (account.deleted) throw new Error("Seller account unavailable");
  const flags = {
    charges_enabled: account.charges_enabled,
    payouts_enabled: account.payouts_enabled,
    transfers_enabled: account.capabilities?.transfers === "active",
    checked_at: new Date().toISOString(),
  };
  const { error: updateError } = await db
    .from("market_sellers")
    .update(flags)
    .eq("user_id", userId);
  if (updateError) throw updateError;
  return { ...seller, ...flags };
}
export async function refundMarketPurchase(
  db: ReturnType<typeof service>,
  stripe: Stripe,
  purchaseId: string,
) {
  const { data: p, error } = await db
    .from("market_purchases")
    .select("*")
    .eq("id", purchaseId)
    .single();
  if (error || !p?.payment_intent_id || p.state !== "refund_pending")
    throw new Error("Refund is not pending");
  const intent = await stripe.paymentIntents.retrieve(p.payment_intent_id);
  const chargeId =
    typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge?.id;
  if (chargeId) {
    const charge = await stripe.charges.retrieve(chargeId);
    if (charge.refunded) {
      const { error } = await db.rpc("market_payment_problem", {
        target_purchase: p.id,
        event_id: `known-refund-${charge.id}`,
        problem: "full_refund",
        full_refund: true,
      });
      if (error) throw error;
      return "already_refunded";
    }
  }
  const refund = await stripe.refunds.create(
    { payment_intent: p.payment_intent_id, reverse_transfer: true, refund_application_fee: true },
    { idempotencyKey: `market-full-refund-${p.id}` },
  );
  const { error: saveError } = await db
    .from("market_purchases")
    .update({ refund_id: refund.id, checked_at: new Date().toISOString() })
    .eq("id", p.id);
  if (saveError) throw saveError;
  if (refund.status === "succeeded") {
    const { error: commitError } = await db.rpc("market_payment_problem", {
      target_purchase: p.id,
      event_id: `refund-${refund.id}`,
      problem: "full_refund",
      full_refund: true,
    });
    if (commitError) throw commitError;
  }
  return refund.id;
}
export async function completeMarketSession(
  db: ReturnType<typeof service>,
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  eventId: string,
) {
  if (session.payment_status !== "paid") return { awaitingPayment: true };
  const id = session.metadata?.market_purchase_id;
  if (!id) throw new Error("Missing marketplace purchase");
  const intentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;
  if (!intentId) throw new Error("Payment reference unavailable");
  const intent = await stripe.paymentIntents.retrieve(intentId);
  if (
    intent.status !== "succeeded" ||
    intent.amount_received !== session.amount_total ||
    intent.metadata?.market_purchase_id !== id
  )
    throw new Error("Payment confirmation mismatch");
  const destination =
    typeof intent.transfer_data?.destination === "string"
      ? intent.transfer_data.destination
      : intent.transfer_data?.destination?.id;
  const { data, error } = await db.rpc("finalize_market_sale", {
    target_purchase: id,
    session_id: session.id,
    payment_id: intent.id,
    event_id: eventId,
    paid_cents: intent.amount_received,
    paid_currency: intent.currency,
    fee: intent.application_fee_amount ?? -1,
    destination: destination ?? "",
  });
  if (error) throw error;
  if (data?.refundRequired) await refundMarketPurchase(db, stripe, id);
  return data;
}
export async function handleMarketProblem(
  db: ReturnType<typeof service>,
  stripe: Stripe,
  event: Stripe.Event,
) {
  const object = event.data.object as unknown as {
    id: string;
    payment_intent?: string | { id: string };
    charge?: string | { id: string };
    refunded?: boolean;
    status?: string;
  };
  let charge: Stripe.Charge;
  if (event.type.startsWith("charge.dispute.")) {
    const id = typeof object.charge === "string" ? object.charge : object.charge?.id;
    if (!id) return;
    charge = await stripe.charges.retrieve(id);
  } else if (event.type === "refund.updated") {
    if (object.status !== "succeeded") return;
    const id = typeof object.charge === "string" ? object.charge : object.charge?.id;
    if (!id) return;
    charge = await stripe.charges.retrieve(id);
  } else charge = event.data.object as Stripe.Charge;
  const intentId =
    typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!intentId) return;
  const intent = await stripe.paymentIntents.retrieve(intentId);
  const purchaseId = intent.metadata?.market_purchase_id;
  if (intent.metadata?.kind !== "secondary" || !purchaseId) return;
  const { error } = await db.rpc("market_payment_problem", {
    target_purchase: purchaseId,
    event_id: event.id,
    problem: event.type,
    full_refund: Boolean(charge.refunded && !event.type.startsWith("charge.dispute.")),
  });
  if (error) throw error;
}
