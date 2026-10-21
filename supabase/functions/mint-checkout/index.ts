import Stripe from "npm:stripe@18";
import { corsFor, json, service, sha256, randomToken, studioSiteUrl } from "../_shared/common.ts";
Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsFor(request) });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, request);
  try {
    if (Deno.env.get("FOIL_CHECKOUT_ENABLED") !== "true")
      return json({ error: "Foil editions are not open yet." }, 503, request);
    const db = service();
    const token = request.headers.get("Authorization")?.replace(/^Bearer /i, "") || "";
    const {
      data: { user },
      error: authError,
    } = await db.auth.getUser(token);
    if (authError || !user)
      return json({ error: "Sign in to your collection before minting." }, 401, request);
    const { artworkId } = await request.json();
    if (!Number.isSafeInteger(Number(artworkId)) || Number(artworkId) < 1)
      return json({ error: "Invalid artwork." }, 400, request);
    const secret = Deno.env.get("STRIPE_SECRET_KEY");
    if (!secret) throw new Error("Stripe is not configured");
    const access = randomToken();
    const { data: reservation, error } = await db.rpc("reserve_foil_order", {
      target_artwork: Number(artworkId),
      buyer: user.id,
      token_hash: await sha256(access),
    });
    if (error)
      return json(
        { error: "This edition is unavailable or fully reserved. Please try later." },
        409,
        request,
      );
    const stripe = new Stripe(secret);
    // Keep reserved inventory until Stripe confirms expiry. Never release on a
    // network timeout: the provider may have created a payable session.
    const checkout = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],
        expires_at: Math.floor(Date.now() / 1000) + 1800,
        customer_email: user.email,
        success_url: `${studioSiteUrl()}/checkout-success.html?order=${reservation.orderId}&access=${access}&provider=stripe`,
        cancel_url: `${studioSiteUrl()}/collection.html`,
        metadata: { order_id: reservation.orderId, kind: "foil" },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: Math.round(Number(reservation.price) * 100),
              product_data: {
                name: `${reservation.title} — Foil Edition`,
                description:
                  "One numbered digital variant. Random rarity; edition caps apply. No blockchain token or financial return promised.",
              },
            },
          },
        ],
      },
      { idempotencyKey: `foil-${reservation.orderId}` },
    );
    const { error: saveError } = await db
      .from("orders")
      .update({ provider_order_id: checkout.id })
      .eq("id", reservation.orderId)
      .eq("status", "pending");
    if (saveError || !checkout.url) throw new Error("Checkout linkage needs recovery");
    return json({ orderId: reservation.orderId, checkoutUrl: checkout.url }, 201, request);
  } catch (error) {
    console.error("Mint checkout failed", error instanceof Error ? error.message : "unknown");
    return json(
      { error: "Mint checkout could not be opened. Contact the studio if this continues." },
      500,
      request,
    );
  }
});
