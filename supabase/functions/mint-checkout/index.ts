import { printsEnabled, printMode } from "../_shared/gelato.ts";
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
    const { artworkId, offer } = await request.json();
    const forgePrint = offer !== undefined;
    if (
      forgePrint &&
      (!["digital", "canvas"].includes(offer) || Deno.env.get("FORGE_PRINT_ENABLED") !== "true")
    )
      return json({ error: "This roll offer is not open." }, 503, request);
    if (offer === "canvas" && Deno.env.get("FORGE_PRINT_CANVAS_ENABLED") !== "true")
      return json({ error: "Canvas-inclusive rolls are not open." }, 503, request);
    if (!Number.isSafeInteger(Number(artworkId)) || Number(artworkId) < 1)
      return json({ error: "Invalid artwork." }, 400, request);
    const secret = Deno.env.get("STRIPE_SECRET_KEY");
    if (!secret) throw new Error("Stripe is not configured");
    if (
      offer === "canvas" &&
      (!printsEnabled() || secret.startsWith("sk_test_") !== (printMode() === "sandbox"))
    )
      return json(
        { error: "Canvas fulfillment and payment environments must both be ready." },
        503,
        request,
      );
    if (
      forgePrint &&
      secret.startsWith("sk_live_") &&
      Deno.env.get("FORGE_PRINT_TAX_ENABLED") !== "true"
    )
      return json({ error: "Live roll tax settings are not ready." }, 503, request);
    const access = randomToken();
    const { data: reservation, error } = await db.rpc(
      forgePrint ? "reserve_forge_print_order" : "reserve_foil_order",
      {
        target_artwork: Number(artworkId),
        buyer: user.id,
        token_hash: await sha256(access),
        ...(forgePrint ? { chosen_offer: offer, is_test: secret.startsWith("sk_test_") } : {}),
      },
    );
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
        ...(forgePrint
          ? {
              billing_address_collection: "required" as const,
              automatic_tax: { enabled: Deno.env.get("FORGE_PRINT_TAX_ENABLED") === "true" },
            }
          : {}),
        ...(offer === "canvas"
          ? {
              shipping_address_collection: { allowed_countries: ["US"] as Array<"US"> },
              shipping_options: [
                {
                  shipping_rate_data: {
                    display_name: "Prepaid US canvas shipping",
                    tax_behavior: "exclusive" as const,
                    tax_code: "txcd_92010001",
                    type: "fixed_amount" as const,
                    fixed_amount: { amount: 1349, currency: "usd" },
                  },
                },
              ],
            }
          : {}),
        metadata: { order_id: reservation.orderId, kind: forgePrint ? "forgeprint" : "foil" },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              ...(forgePrint ? { tax_behavior: "exclusive" as const } : {}),
              unit_amount: forgePrint
                ? offer === "canvas"
                  ? 6900
                  : 800
                : Math.round(Number(reservation.price) * 100),
              product_data: {
                name: `${reservation.title} — ${offer === "canvas" ? "Canvas + Digital Roll" : "Digital Edition"}`,
                description:
                  offer === "canvas"
                    ? "One digital variant and one included US canvas claim. Production waits for redemption in My Vault."
                    : "One numbered digital variant. Printing is optional and separate. Edition caps apply.",
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
