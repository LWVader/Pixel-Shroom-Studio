// SECTION: Shared Supabase utilities
import {
  json,
  service,
} from "../_shared/common.ts";

// SECTION: Buyer-token hashing
async function hashToken(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);

  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoded,
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// SECTION: Expiring private-original download
Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed." }, 405);
  }

  try {
    const requestUrl = new URL(request.url);
    const orderId = requestUrl.searchParams.get("order");
    const accessToken = requestUrl.searchParams.get("access");

    if (!orderId || !accessToken) {
      return json({ error: "Missing download credentials." }, 400);
    }

    const database = service();

    const { data: order, error: orderError } = await database
      .from("orders")
      .select(`
        id,
        status,
        buyer_token_hash,
        artworks (
          category,
          original_path
        )
      `)
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return json({ error: "Order not found." }, 404);
    }

    const suppliedTokenHash = await hashToken(accessToken);

    if (
      order.status !== "paid" ||
      suppliedTokenHash !== order.buyer_token_hash
    ) {
      return json({ error: "Invalid download credentials." }, 403);
    }

    const artwork = Array.isArray(order.artworks)
      ? order.artworks[0]
      : order.artworks;

    if (
      !artwork ||
      artwork.category === "NFT" ||
      !artwork.original_path
    ) {
      return json({ error: "Original unavailable." }, 404);
    }

    // SECTION: Atomically enforce expiration and download limit
    const { data: downloadAllowed, error: licenseError } =
      await database.rpc("consume_download", {
        target_order: order.id,
      });

    if (licenseError) {
      throw licenseError;
    }

    if (!downloadAllowed) {
      return json(
        { error: "Download expired or limit reached." },
        403,
      );
    }

    // SECTION: Generate a one-minute private Storage URL
    const { data: signedDownload, error: signingError } =
      await database.storage
        .from("originals")
        .createSignedUrl(
          artwork.original_path,
          60,
          {
            download: true,
          },
        );

    if (signingError || !signedDownload?.signedUrl) {
      throw signingError ?? new Error("Signed URL was not created.");
    }

    return Response.redirect(
      signedDownload.signedUrl,
      302,
    );
  } catch (error) {
    console.error("Original download failed:", error);

    return json(
      { error: "Original download could not be created." },
      500,
    );
  }
});