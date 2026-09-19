import { cors, json, service, sha256 } from "../_shared/common.ts";
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { orderId, accessToken } = await request.json(), db = service();
    const { data: order } = await db.from("orders").select("id,status,fulfillment_status,access_token_hash,artworks(original_path,category),licenses(expires_at,download_count,download_limit)").eq("id", orderId).single();
    if (!order || order.access_token_hash !== await sha256(accessToken)) return json({ error: "Invalid order access." }, 403);
    let downloadUrl = null; const license = order.licenses?.[0];
    if (order.status === "paid" && order.artworks?.category !== "NFT" && order.artworks?.original_path && license && new Date(license.expires_at) > new Date() && license.download_count < license.download_limit) {
      const { data, error } = await db.storage.from("originals").createSignedUrl(order.artworks.original_path, 300, { download: true });
      if (!error) { downloadUrl = data.signedUrl; await db.from("licenses").update({ download_count: license.download_count + 1 }).eq("order_id", order.id).eq("download_count", license.download_count); }
    }
    return json({ status: order.status, fulfillmentStatus: order.fulfillment_status, downloadUrl });
  } catch { return json({ error: "Order lookup failed." }, 500); }
});

