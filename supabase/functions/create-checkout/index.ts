// SECTION: Dependencies and shared server utilities
import Stripe from "npm:stripe@18";
import {
  cors,
  json,
  randomToken,
  service,
  sha256,
} from "../_shared/common.ts";

// SECTION: Checkout request and provider response types
type PaymentProvider = "stripe" | "paypal";

interface CheckoutRequest {
  artworkId?: number | string;
  provider?: PaymentProvider;
  buyerEmail?: string;
}

interface Artwork {
  id: number | string;
  title: string;
  price: number | string;
  category: string;
}

interface LocalOrder {
  id: number | string;
}

interface PayPalAccessTokenResponse {
  access_token?: string;
  error_description?: string;
}

interface PayPalLink {
  rel: string;
  href: string;
}

interface PayPalOrderResponse {
  id?: string;
  message?: string;
  links?: PayPalLink[];
}

// SECTION: Environment and input validation
function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function normalizeSiteUrl(): string {
  return requiredEnvironment("SITE_URL").replace(/\/$/, "");
}

function validEmail(value: string): boolean {
  return /^\S+@\S+\.\S+$/.test(value);
}

function validateRequest(body: CheckoutRequest): {
  artworkId: number | string;
  provider: PaymentProvider;
  buyerEmail: string;
} {
  const artworkId = body.artworkId;
  const provider = body.provider;
  const buyerEmail = String(body.buyerEmail ?? "").trim();

  if (artworkId === undefined || artworkId === null || artworkId === "") {
    throw new Error("An artwork ID is required.");
  }

  if (provider !== "stripe" && provider !== "paypal") {
    throw new Error("Invalid payment provider.");
  }

  if (buyerEmail && !validEmail(buyerEmail)) {
    throw new Error("Enter a valid buyer email address.");
  }

  return { artworkId, provider, buyerEmail };
}

// SECTION: Artwork lookup and pending-order creation
async function findArtwork(artworkId: number | string): Promise<Artwork> {
  const db = service();
  const { data, error } = await db
    .from("artworks")
    .select("id,title,price,category")
    .eq("id", artworkId)
    .eq("status", "published")
    .single();

  if (error || !data) throw new Error("Artwork is unavailable.");

  const price = Number(data.price);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Artwork has an invalid price.");
  }

  return data as Artwork;
}

async function createPendingOrder(
  artwork: Artwork,
  provider: PaymentProvider,
  buyerEmail: string,
  accessToken: string,
): Promise<LocalOrder> {
  const db = service();
  const { data, error } = await db
    .from("orders")
    .insert({
      artwork_id: artwork.id,
      provider,
      amount: Number(artwork.price),
      buyer_email: buyerEmail || null,
      access_token_hash: await sha256(accessToken),
      status: "pending",
      fulfillment_status:
        artwork.category === "NFT" ? "email_pending" : "pending",
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Could not create the pending order.");
  }

  return data as LocalOrder;
}

async function saveProviderOrderId(
  localOrderId: number | string,
  providerOrderId: string,
): Promise<void> {
  const { error } = await service()
    .from("orders")
    .update({ provider_order_id: providerOrderId })
    .eq("id", localOrderId);

  if (error) throw new Error(error.message);
}

// SECTION: Stripe Checkout
async function createStripeCheckout(
  artwork: Artwork,
  order: LocalOrder,
  buyerEmail: string,
  successUrl: string,
  cancelUrl: string,
): Promise<string> {
  const stripe = new Stripe(requiredEnvironment("STRIPE_SECRET_KEY"));
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    success_url: `${successUrl}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl,
    customer_email: buyerEmail || undefined,
    metadata: {
      order_id: String(order.id),
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: Math.round(Number(artwork.price) * 100),
          product_data: {
            name: artwork.title,
            description: `${artwork.category} digital artwork license`,
          },
        },
      },
    ],
  });

  if (!session.url) throw new Error("Stripe did not return a Checkout URL.");
  await saveProviderOrderId(order.id, session.id);
  return session.url;
}

// SECTION: PayPal access token and order creation
function paypalApiBase(): string {
  return Deno.env.get("PAYPAL_ENV") === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

async function getPayPalAccessToken(baseUrl: string): Promise<string> {
  const clientId = requiredEnvironment("PAYPAL_CLIENT_ID");
  const clientSecret = requiredEnvironment("PAYPAL_CLIENT_SECRET");
  const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const payload = await response.json() as PayPalAccessTokenResponse;

  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || "PayPal authentication failed.");
  }

  return payload.access_token;
}

async function createPayPalCheckout(
  artwork: Artwork,
  order: LocalOrder,
  successUrl: string,
  cancelUrl: string,
): Promise<string> {
  const baseUrl = paypalApiBase();
  const accessToken = await getPayPalAccessToken(baseUrl);
  const response = await fetch(`${baseUrl}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": String(order.id),
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: String(order.id),
          custom_id: String(order.id),
          description: artwork.title,
          amount: {
            currency_code: "USD",
            value: Number(artwork.price).toFixed(2),
          },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            user_action: "PAY_NOW",
            return_url: successUrl,
            cancel_url: cancelUrl,
          },
        },
      },
    }),
  });
  const payload = await response.json() as PayPalOrderResponse;

  if (!response.ok || !payload.id) {
    throw new Error(payload.message || "PayPal checkout failed.");
  }

  const approvalUrl = payload.links?.find((link) =>
    link.rel === "payer-action" || link.rel === "approve"
  )?.href;
  if (!approvalUrl) throw new Error("PayPal did not return an approval URL.");

  await saveProviderOrderId(order.id, payload.id);
  return approvalUrl;
}

// SECTION: Edge Function request handler
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  try {
    const requestBody = await request.json() as CheckoutRequest;
    const { artworkId, provider, buyerEmail } = validateRequest(requestBody);
    const artwork = await findArtwork(artworkId);

    if (artwork.category === "NFT" && !validEmail(buyerEmail)) {
      return json({ error: "A delivery email is required for NFT orders." }, 400);
    }

    const accessToken = randomToken();
    const order = await createPendingOrder(
      artwork,
      provider,
      buyerEmail,
      accessToken,
    );
    const siteUrl = normalizeSiteUrl();
    const successUrl =
      `${siteUrl}/checkout-success.html?order=${order.id}` +
      `&access=${encodeURIComponent(accessToken)}` +
      `&provider=${provider}`;
    const cancelUrl =
      `${siteUrl}/checkout-cancel.html?order=${encodeURIComponent(String(order.id))}`;

    const checkoutUrl = provider === "stripe"
      ? await createStripeCheckout(
        artwork,
        order,
        buyerEmail,
        successUrl,
        cancelUrl,
      )
      : await createPayPalCheckout(
        artwork,
        order,
        successUrl,
        cancelUrl,
      );

    return json({ orderId: order.id, checkoutUrl }, 201);
  } catch (error) {
    console.error("Checkout creation failed:", error);
    return json(
      {
        error: error instanceof Error ? error.message : "Checkout failed.",
      },
      500,
    );
  }
});
