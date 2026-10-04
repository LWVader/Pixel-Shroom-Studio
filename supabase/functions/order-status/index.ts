// SECTION: Shared database, security, and response utilities
import { corsFor, json, service, sha256 } from "../_shared/common.ts";

interface StatusRequest {
  orderId?: string;
  accessToken?: string;
}

// SECTION: Webhook-confirmed buyer order status
Deno.serve(async (request: Request): Promise<Response> => {
  const respond = (data: unknown, status = 200) => json(data, status, request);
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsFor(request) });
  }

  if (request.method !== "POST") {
    return respond({ error: "Method not allowed." }, 405);
  }

  try {
    const { orderId, accessToken } = (await request.json()) as StatusRequest;
    if (!orderId || !accessToken) {
      return respond({ error: "Order credentials are required." }, 400);
    }

    const database = service();
    const { data: order, error } = await database
      .from("orders")
      .select(
        `
        id,
        status,
        fulfillment_status,
        access_token_hash,
        artworks(title, category, serial_number),
        licenses(expires_at, download_limit, download_count)
      `,
      )
      .eq("id", orderId)
      .single();

    const suppliedHash = await sha256(accessToken);
    if (error || !order || suppliedHash !== order.access_token_hash) {
      return respond({ error: "Invalid order access token." }, 403);
    }

    const artwork = Array.isArray(order.artworks) ? order.artworks[0] : order.artworks;
    const license = Array.isArray(order.licenses) ? order.licenses[0] : order.licenses;
    const expiresAt = license?.expires_at ?? null;
    const downloadsRemaining = license
      ? Math.max(0, license.download_limit - license.download_count)
      : 0;
    const downloadAvailable =
      order.status === "paid" &&
      artwork?.category !== "NFT" &&
      Boolean(expiresAt) &&
      new Date(expiresAt).getTime() > Date.now() &&
      downloadsRemaining > 0;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
    const downloadUrl =
      downloadAvailable && supabaseUrl
        ? `${supabaseUrl}/functions/v1/download-original` +
          `?order=${encodeURIComponent(orderId)}` +
          `&access=${encodeURIComponent(accessToken)}`
        : null;

    return respond({
      orderId: order.id,
      status: order.status,
      title: artwork?.title ?? "Artwork",
      category: artwork?.category ?? "",
      serialNumber: artwork?.serial_number ?? "",
      fulfillmentStatus: order.fulfillment_status,
      expiresAt,
      downloadsRemaining,
      downloadUrl,
    });
  } catch (error) {
    console.error("Order-status lookup failed:", error);
    return respond({ error: "Order status is unavailable." }, 500);
  }
});
