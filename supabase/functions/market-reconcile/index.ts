import { json, service } from "../_shared/common.ts";
import { marketStripe, completeMarketSession, refundMarketPurchase } from "../_shared/market.ts";
Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key || request.headers.get("Authorization") !== `Bearer ${key}`)
    return json({ error: "Service authorization required." }, 403);
  try {
    const db = service(),
      stripe = marketStripe();
    const { data: rows, error } = await db
      .from("market_purchases")
      .select("*")
      .in("state", ["pending", "refund_pending"])
      .order("checked_at", { ascending: true, nullsFirst: true })
      .limit(10);
    if (error) throw error;
    let handled = 0;
    const started = Date.now();
    for (const purchase of rows || []) {
      if (Date.now() - started > 40000) break;
      try {
        if (purchase.state === "refund_pending")
          await refundMarketPurchase(db, stripe, purchase.id);
        else {
          let session;
          if (purchase.checkout_session_id)
            session = await stripe.checkout.sessions.retrieve(purchase.checkout_session_id);
          else {
            for await (const candidate of stripe.checkout.sessions.list({
              created: {
                gte: Math.floor(new Date(purchase.created_at).getTime() / 1000) - 60,
                lte: Math.floor(new Date(purchase.created_at).getTime() / 1000) + 3600,
              },
              limit: 100,
            }))
              if (
                candidate.metadata?.market_purchase_id === purchase.id &&
                candidate.metadata?.kind === "secondary"
              ) {
                session = candidate;
                break;
              }
            if (session) {
              const { error } = await db
                .from("market_purchases")
                .update({ checkout_session_id: session.id })
                .eq("id", purchase.id);
              if (error) throw error;
            }
          }
          if (session?.payment_status === "paid")
            await completeMarketSession(db, stripe, session, `market-reconcile-${session.id}`);
          else if (session?.status === "expired") {
            const { error } = await db.rpc("expire_market_checkout", {
              target_purchase: purchase.id,
              session_id: session.id,
            });
            if (error) throw error;
          }
        }
        handled++;
      } catch (error) {
        console.error(
          "Marketplace recovery will retry",
          purchase.id,
          error instanceof Error ? error.message : "unknown",
        );
      }
      await db
        .from("market_purchases")
        .update({ checked_at: new Date().toISOString() })
        .eq("id", purchase.id);
    }
    return json({ checked: rows?.length || 0, handled });
  } catch {
    return json({ error: "Marketplace reconciliation unavailable." }, 500);
  }
});
