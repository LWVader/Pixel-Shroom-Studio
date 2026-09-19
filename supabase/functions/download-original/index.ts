// SECTION: Shared database, security, and response utilities
import { json, service, sha256 } from "../_shared/common.ts";

// SECTION: Expiring, download-limited original delivery
Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed." }, 405);
  }

  try {
    const requestUrl = new URL(request.url);
    const orderId = requestUrl.searchParams.get("order");
    const accessToken = requestUrl.searchParams.get("access");

    if (!orderId || !accessToken) {
      return json({ error: "Download credentials are required." }, 400);
    }

    const database = service();
    const { data: order, error: orderError } = await database
      .from("orders")
      .select(`
        status,
        access_token_hash,
        artworks(original_path, category)
      `)
      .eq("id", orderId)
      .single();
    const suppliedHash = await sha256(accessToken);
    const artwork = Array.isArray(order?.artworks)
      ? order.artworks[0]
      : order?.artworks;

    if (
      orderError ||
      !order ||
      order.status !== "paid" ||
      artwork?.category === "NFT" ||
      !artwork?.original_path ||
      suppliedHash !== order.access_token_hash
    ) {
      return json({ error: "Invalid download." }, 403);
    }

    // Atomically enforce both the expiration time and download limit.
    const { data: allowed, error: consumeError } = await database.rpc(
      "consume_download",
      { target_order: orderId },
    );
    if (consumeError) throw consumeError;
    if (!allowed) {
      return json({ error: "Download expired or limit reached." }, 403);
    }

    // The private Storage URL is valid for only 60 seconds.
    const { data: signedDownload, error: signingError } = await database.storage
      .from("originals")
      .createSignedUrl(artwork.original_path, 60, { download: true });
    if (signingError || !signedDownload?.signedUrl) {
      throw signingError || new Error("The signed URL was not created.");
    }

    return Response.redirect(signedDownload.signedUrl, 302);
  } catch (error) {
    console.error("Original download failed:", error);
    return json({ error: "Original download is unavailable." }, 500);
  }
});
