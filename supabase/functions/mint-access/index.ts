import { corsFor, json, service, sha256 } from "../_shared/common.ts";
Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsFor(request) });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, request);
  try {
    const db = service();
    const body = await request.json();
    if (body.action === "key") {
      const { data, error } = await db
        .from("foil_keys")
        .select("public_key_jwk")
        .eq("key_id", String(body.keyId))
        .single();
      if (error || !data) return json({ error: "Unknown studio signing key." }, 404, request);
      return json({ publicKey: data.public_key_jwk }, 200, request);
    }
    const bearer = request.headers.get("Authorization")?.replace(/^Bearer /i, "") || "";
    const {
      data: { user },
    } = await db.auth.getUser(bearer);
    if (body.action === "add_to_collection") {
      if (!user) return json({ error: "Sign in to add this edition." }, 401, request);
      if (!body.mintId) return json({ error: "Mint ID required." }, 400, request);
      const { data, error } = await db.rpc("add_mint_to_collection", {
        target_mint: body.mintId,
        holder: user.id,
      });
      if (error)
        return json(
          { error: "This paid edition is not ready to add to your collection." },
          409,
          request,
        );
      return json({ added: data === true }, 200, request);
    }
    let query = db
      .from("mints")
      .select(
        "id,order_id,owner_id,collection_added_at,ownership_version,market_frozen,listing_id,state,mint_number,tier,artifact_path,manifest,width,height,created_at,foil_listings(master_title,master_serial,max_supply)",
      );
    let orderCredentialAccess = false;
    if (body.orderId && body.accessToken && !["collection", "uncollected"].includes(body.action)) {
      const { data: order, error } = await db
        .from("orders")
        .select("id,status,access_token_hash,sale_kind")
        .eq("id", body.orderId)
        .single();
      if (
        error ||
        !order ||
        order.sale_kind !== "foil" ||
        (await sha256(String(body.accessToken))) !== order.access_token_hash
      )
        return json({ error: "Invalid order credentials." }, 403, request);
      orderCredentialAccess = true;
      query = query.eq("order_id", order.id);
    } else {
      if (!user) return json({ error: "Sign in to access your collection." }, 401, request);
      query = query.eq("owner_id", user.id);
      if (body.mintId) query = query.eq("id", body.mintId);
    }
    if (!["collection", "uncollected", "status", "download"].includes(body.action))
      return json({ error: "Invalid action." }, 400, request);
    if (body.action === "download" && !body.mintId)
      return json({ error: "Mint ID required." }, 400, request);
    if (body.mintId) query = query.eq("id", body.mintId);
    if (body.action === "collection") query = query.not("collection_added_at", "is", null);
    if (body.action === "uncollected") query = query.is("collection_added_at", null);
    const offset =
      ["collection", "uncollected"].includes(body.action) &&
      Number.isInteger(body.offset) &&
      body.offset >= 0
        ? Math.min(body.offset, 1000000)
        : 0;
    const { data: rows, error } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + 25);
    if (error) throw error;
    const result = [];
    for (const row of (rows || []).slice(0, 25)) {
      if (orderCredentialAccess && Number(row.ownership_version) > 0) continue;
      const listing = Array.isArray(row.foil_listings) ? row.foil_listings[0] : row.foil_listings;
      // Paid-only private access. Refunds/revocation stop fresh signed URLs.
      const { data: order } = await db
        .from("orders")
        .select("status")
        .eq("id", row.order_id)
        .single();
      let imageUrl = null;
      if (
        body.action !== "uncollected" &&
        row.state === "ready" &&
        !row.market_frozen &&
        order?.status === "paid" &&
        row.artifact_path
      ) {
        const { data, error: signingError } = await db.storage
          .from("minted")
          .createSignedUrl(row.artifact_path, 60, { download: body.action === "download" });
        if (signingError) throw signingError;
        imageUrl = data?.signedUrl;
      }
      result.push({
        id: row.id,
        paymentConfirmed: order?.status === "paid",
        inCollection: Boolean(row.collection_added_at),
        title: listing?.master_title,
        serial: listing?.master_serial,
        maxSupply: listing?.max_supply,
        state: row.market_frozen ? "held" : row.state,
        canList: row.state === "ready" && !row.market_frozen && order?.status === "paid",
        mintNumber: row.mint_number,
        tier: row.tier,
        width: row.width,
        height: row.height,
        imageUrl,
        manifest: imageUrl ? row.manifest : null,
      });
    }
    return json({ items: result, hasMore: (rows || []).length > 25 }, 200, request);
  } catch (error) {
    console.error("Mint access failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "Mint access is temporarily unavailable." }, 500, request);
  }
});
