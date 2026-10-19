import fs from "node:fs";
import { createPrivateKey, createPublicKey } from "node:crypto";
import Stripe from "stripe";
import { renderMint, renderMarketPreview, sha256 } from "./render.mjs";
const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!base?.startsWith("https://") || !secret)
  throw new Error("Worker Supabase configuration required");
const privateKey = createPrivateKey(
  process.env.MINT_SIGNING_KEY_B64
    ? Buffer.from(process.env.MINT_SIGNING_KEY_B64, "base64")
    : fs.readFileSync(process.env.MINT_SIGNING_KEY_FILE),
);
if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("Ed25519 signing key required");
const publicKey = createPublicKey(privateKey);
const jwk = publicKey.export({ format: "jwk" });
const keyId = sha256(publicKey.export({ format: "der", type: "spki" })).slice(0, 32);
const headers = {
  apikey: secret,
  Authorization: `Bearer ${secret}`,
  "Content-Type": "application/json",
};
async function api(path, body, extra = {}) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...headers, ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Private API request failed (${response.status})`);
  const value = await response.text();
  return value ? JSON.parse(value) : null;
}
const rpc = (name, body = {}) => api(`/rest/v1/rpc/${name}`, body);
// Never rotate a key underneath already signed receipts.
await api(
  "/rest/v1/foil_keys?on_conflict=key_id",
  { key_id: keyId, public_key_jwk: jwk },
  { Prefer: "resolution=ignore-duplicates,return=minimal" },
);
async function processOne() {
  const job = await rpc("claim_foil_job");
  if (!job) return processMarketPreview();
  const { mint, listing } = job;
  try {
    const download = await fetch(
      `${base}/storage/v1/object/authenticated/originals/${listing.master_path.split("/").map(encodeURIComponent).join("/")}`,
      { headers, signal: AbortSignal.timeout(60000) },
    );
    if (!download.ok || Number(download.headers.get("content-length")) > 104857600)
      throw new Error("Master download unavailable");
    const bytes = Buffer.from(await download.arrayBuffer());
    if (bytes.length > 104857600) throw new Error("Master exceeds size limit");
    const artifact = await renderMint(bytes, job, privateKey, keyId);
    const path = `${mint.owner_id}/${mint.id}/${mint.lease_id}.webp`;
    const uploaded = await fetch(`${base}/storage/v1/object/minted/${path}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "image/webp", "x-upsert": "false" },
      body: artifact.bytes,
      signal: AbortSignal.timeout(60000),
    });
    if (!uploaded.ok) throw new Error("Derivative storage failed");
    const committed = await rpc("finish_foil_job", {
      target_mint: mint.id,
      lease: mint.lease_id,
      artifact: path,
      file_sha256: artifact.manifest.payload.sha256,
      receipt: artifact.manifest,
      image_width: artifact.width,
      image_height: artifact.height,
    });
    console.log(committed ? "Mint ready" : "Lease expired; artifact not committed", mint.id);
  } catch (error) {
    console.error("Mint rendering failed", mint.id, error.message);
    await rpc("fail_foil_job", { target_mint: mint.id, lease: mint.lease_id });
  }
  return true;
}
async function processMarketPreview() {
  let job;
  try {
    job = await rpc("claim_market_preview");
  } catch (error) {
    // Existing mint-only installations may not yet have the optional market migration.
    if (error.message.includes("404")) return false;
    throw error;
  }
  if (!job) return false;
  try {
    const source = await fetch(
      `${base}/storage/v1/object/authenticated/minted/${job.artifactPath.split("/").map(encodeURIComponent).join("/")}`,
      { headers, signal: AbortSignal.timeout(60000) },
    );
    if (!source.ok || Number(source.headers.get("content-length")) > 104857600)
      throw new Error("Variant preview source unavailable");
    const bytes = Buffer.from(await source.arrayBuffer());
    if (bytes.length > 104857600) throw new Error("Variant source too large");
    const preview = await renderMarketPreview(bytes, job);
    const path = `secondary/${job.listingId}/${job.leaseId}.webp`;
    const response = await fetch(`${base}/storage/v1/object/previews/${path}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "image/webp", "x-upsert": "false" },
      body: preview,
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error("Protected market preview upload failed");
    await rpc("finish_market_preview", { target_listing: job.listingId, lease: job.leaseId, path });
    console.log("Market protected preview ready", job.listingId);
  } catch (error) {
    console.error("Market preview will retry", job.listingId, error.message);
    await rpc("fail_market_preview", { target_listing: job.listingId, lease: job.leaseId });
  }
  return true;
}
// Reconcile only against Stripe's actual session state, never a wall-clock timeout.
async function reconcile() {
  if (!process.env.STRIPE_SECRET_KEY) return;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  async function* pendingOrders() {
    let cursor;
    for (;;) {
      const query = new URLSearchParams({
        select: "id,provider_order_id,created_at",
        sale_kind: "eq.foil",
        status: "eq.pending",
        order: "created_at.asc,id.asc",
        limit: "100",
      });
      if (cursor)
        query.set(
          "or",
          `(created_at.gt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.gt.${cursor.id}))`,
        );
      const page = await api(`/rest/v1/orders?${query}`);
      for (const row of page) yield row;
      if (page.length < 100) return;
      cursor = page.at(-1);
    }
  }
  for await (const order of pendingOrders()) {
    try {
      let session;
      if (order.provider_order_id)
        session = await stripe.checkout.sessions.retrieve(order.provider_order_id);
      else {
        // Covers a provider request succeeding just before linkage/storage failed.
        for await (const candidate of stripe.checkout.sessions.list({
          created: {
            gte: Math.floor(new Date(order.created_at).getTime() / 1000) - 60,
            lte: Math.floor(new Date(order.created_at).getTime() / 1000) + 3600,
          },
          limit: 100,
        })) {
          if (candidate.metadata?.order_id === order.id && candidate.metadata?.kind === "foil") {
            session = candidate;
            break;
          }
        }
        if (session) {
          const response = await fetch(
            `${base}/rest/v1/orders?id=eq.${order.id}&provider_order_id=is.null`,
            { method: "PATCH", headers, body: JSON.stringify({ provider_order_id: session.id }) },
          );
          if (!response.ok) throw new Error("Session recovery failed");
        } else {
          console.warn("Unlinked reservation needs studio review", order.id);
          continue;
        }
      }
      if (session.status === "expired")
        await rpc("release_foil_order", { target_order: order.id, checkout_session: session.id });
      else if (session.payment_status === "paid")
        await rpc("fulfill_stripe_checkout_verified", {
          payment_event_id: `reconcile-${session.id}`,
          checkout_session_id: session.id,
          local_order_id: order.id,
          paid_amount_cents: session.amount_total,
          paid_currency: session.currency,
          customer_email: session.customer_details?.email || null,
        });
    } catch (error) {
      console.error("Checkout reconciliation needs retry", order.id, error.message);
    }
  }
}
try {
  await reconcile();
} catch (error) {
  console.error("Payment reconciliation will retry", error.message);
}
if (process.argv.includes("--once")) await processOne();
else if (process.argv.includes("--batch")) {
  const limit = Math.min(100, Math.max(1, Number(process.env.MINT_BATCH_LIMIT) || 10));
  const budget = Math.min(420000, Math.max(1000, Number(process.env.MINT_BATCH_TIME_MS) || 420000));
  const started = Date.now();
  let count = 0;
  while (count < limit && Date.now() - started < budget && (await processOne())) count++;
  console.log("Mint batch finished", { processed: count });
} else {
  let lastReconcile = Date.now();
  for (;;) {
    try {
      if (Date.now() - lastReconcile > 60000) {
        try {
          await reconcile();
        } catch (error) {
          console.error("Reconciliation will retry", error.message);
        }
        lastReconcile = Date.now();
      }
      if (!(await processOne())) await new Promise((resolve) => setTimeout(resolve, 3000));
    } catch (error) {
      console.error("Worker will retry", error.message);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}
