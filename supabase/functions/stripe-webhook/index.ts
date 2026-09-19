// SECTION: Stripe SDK and shared Supabase utilities
import Stripe from "npm:stripe@18";
import { json, service } from "../_shared/common.ts";

const HANDLED_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
]);

// SECTION: Verified Stripe webhook endpoint
Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  const signature = request.headers.get("stripe-signature");
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

  if (!signature || !stripeSecretKey || !webhookSecret) {
    return json({ error: "Stripe webhook is not configured." }, 500);
  }

  const stripe = new Stripe(stripeSecretKey);
  let event: Stripe.Event;

  // SECTION: Verify Stripe signature against the unmodified request body
  try {
    const rawBody = await request.text();

    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      webhookSecret,
    );
  } catch (error) {
    console.error("Stripe signature verification failed:", error);

    return json({ error: "Invalid webhook signature." }, 400);
  }

  // SECTION: Ignore events that do not trigger fulfillment
  if (!HANDLED_EVENTS.has(event.type)) {
    return json({
      received: true,
      ignored: true,
    });
  }

  try {
    const session = event.data.object as Stripe.Checkout.Session;

    if (session.payment_status !== "paid") {
      return json({
        received: true,
        awaitingPayment: true,
      });
    }

    // Supports either metadata naming format.
    const orderId =
      session.metadata?.order_id ??
      session.metadata?.orderId;

    if (!orderId) {
      throw new Error("Stripe Checkout Session has no order ID.");
    }

    if (session.amount_total === null || !session.currency) {
      throw new Error("Stripe Checkout Session has no payment amount.");
    }

    const database = service();

    // SECTION: Atomically record the event and fulfill the order
    const { data, error } = await database.rpc(
      "fulfill_stripe_checkout",
      {
        payment_event_id: event.id,
        checkout_session_id: session.id,
        local_order_id: orderId,
        paid_amount_cents: session.amount_total,
        paid_currency: session.currency.toLowerCase(),
        customer_email: session.customer_details?.email ?? null,
      },
    );

    if (error) {
      throw error;
    }

    return json({
      received: true,
      duplicate: data?.duplicate ?? false,
      fulfilled: data?.fulfilled ?? false,
    });
  } catch (error) {
    console.error("Stripe webhook fulfillment failed:", error);

    // Returning 500 causes Stripe to retry temporary processing failures.
    return json({ error: "Webhook processing failed." }, 500);
  }
});