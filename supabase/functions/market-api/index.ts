import { corsFor, json, service, studioSiteUrl } from "../_shared/common.ts";
import { marketStripe, syncMarketSeller, refundMarketPurchase } from "../_shared/market.ts";
Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsFor(request) });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, request);
  const reply = (body: unknown, status = 200) => json(body, status, request);
  try {
    const db = service(),
      body = await request.json(),
      enabled = Deno.env.get("MARKETPLACE_ENABLED") === "true";
    if (body.action === "feed") {
      if (!enabled) return reply({ enabled: false, items: [], hasMore: false });
      const tier = ["Standard", "Silver", "Gold", "Emerald", "Sapphire", "Prismatic"].includes(
        body.tier,
      )
        ? body.tier
        : "";
      const offset = Number.isInteger(body.offset) ? Math.max(0, Math.min(100000, body.offset)) : 0;
      const { data, error } = await db.rpc("market_feed", {
        search_term: String(body.search ?? "").slice(0, 120),
        tier_filter: tier,
        page_offset: offset,
      });
      if (error) throw error;
      return reply({
        enabled: true,
        items: (data || []).slice(0, 24),
        hasMore: (data || []).length > 24,
        previewBase: `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/previews/`,
      });
    }
    const bearer = request.headers.get("Authorization")?.replace(/^Bearer /i, "") || "";
    const {
      data: { user },
      error: authError,
    } = await db.auth.getUser(bearer);
    if (authError || !user) return reply({ error: "Sign in to your collection first." }, 401);
    const stripe = marketStripe();
    if (body.action === "purchase") {
      const { data, error } = await db
        .from("market_purchases")
        .select("id,state,listing_id,price_cents,fee_cents,paid_at")
        .eq("id", body.purchaseId)
        .eq("buyer_id", user.id)
        .single();
      if (error || !data) return reply({ error: "Purchase not found." }, 404);
      return reply({ purchase: data });
    }
    if (body.action === "mine") {
      const { data, error } = await db
        .from("secondary_market")
        .select("id,mint_id,price_cents,status,created_at")
        .eq("seller_id", user.id)
        .in("status", ["preparing", "active", "reserved", "frozen"])
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return reply({ enabled, items: data || [] });
    }
    if (body.action === "refund") {
      const { data: admin } = await db
        .from("admin_users")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!admin) return reply({ error: "Studio admin required." }, 403);
      const { error } = await db.rpc("prepare_market_refund", { target_purchase: body.purchaseId });
      if (error) throw error;
      return reply({ refundId: await refundMarketPurchase(db, stripe, body.purchaseId) });
    }
    if (!enabled) return reply({ error: "The secondary marketplace is not open yet." }, 503);
    if (["seller_status", "onboard", "seller_dashboard"].includes(body.action)) {
      let seller = await syncMarketSeller(db, stripe, user.id);
      if (body.action === "seller_status")
        return reply({
          enabled,
          ready: Boolean(
            seller?.charges_enabled && seller?.payouts_enabled && seller?.transfers_enabled,
          ),
          hasAccount: Boolean(seller?.stripe_account_id),
          country: "US",
        });
      if (body.action === "seller_dashboard") {
        if (!seller?.stripe_account_id) return reply({ error: "Complete onboarding first." }, 409);
        const link = await stripe.accounts.createLoginLink(seller.stripe_account_id);
        return reply({ url: link.url });
      }
      if (!seller) {
        const { data, error } = await db
          .from("market_sellers")
          .upsert({ user_id: user.id }, { onConflict: "user_id", ignoreDuplicates: true })
          .select("*")
          .single();
        if (error) throw error;
        seller = data;
      }
      if (!seller.stripe_account_id) {
        const account = await stripe.accounts.create(
          {
            country: "US",
            email: user.email,
            controller: {
              stripe_dashboard: { type: "express" },
              fees: { payer: "application" },
              losses: { payments: "application" },
              requirement_collection: "stripe",
            },
            capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
            metadata: { studio: "pixel-shroom", user_id: user.id },
          },
          { idempotencyKey: `market-seller-${seller.provision_id}` },
        );
        const { error } = await db
          .from("market_sellers")
          .update({ stripe_account_id: account.id })
          .eq("user_id", user.id);
        if (error) throw error;
        seller.stripe_account_id = account.id;
      }
      const link = await stripe.accountLinks.create({
        account: seller.stripe_account_id,
        refresh_url: `${studioSiteUrl()}/collection.html?connect=refresh`,
        return_url: `${studioSiteUrl()}/collection.html?connect=return`,
        type: "account_onboarding",
      });
      return reply({ url: link.url });
    }
    if (body.action === "list") {
      await syncMarketSeller(db, stripe, user.id);
      if (!Number.isInteger(body.priceCents) || body.priceCents < 100 || body.priceCents > 99999999)
        return reply({ error: "Enter a price from $1 to $999,999.99." }, 400);
      const { data, error } = await db.rpc("create_market_listing", {
        target_mint: body.mintId,
        seller: user.id,
        cents: body.priceCents,
      });
      if (error)
        return reply(
          {
            error:
              "This edition cannot be listed. Check ownership, seller onboarding and existing listings.",
          },
          409,
        );
      return reply({ listingId: data, status: "preparing" }, 201);
    }
    if (body.action === "cancel") {
      const { error } = await db.rpc("cancel_market_listing", {
        target_listing: body.listingId,
        seller: user.id,
      });
      if (error)
        return reply({ error: "A reserved, sold or held listing cannot be cancelled." }, 409);
      return reply({ cancelled: true });
    }
    if (body.action === "checkout") {
      const { data: offer } = await db
        .from("secondary_market")
        .select("seller_id")
        .eq("id", body.listingId)
        .single();
      if (!offer) return reply({ error: "Listing unavailable." }, 409);
      await syncMarketSeller(db, stripe, offer.seller_id);
      const { data: reservation, error } = await db.rpc("reserve_market_checkout", {
        target_listing: body.listingId,
        buyer: user.id,
      });
      if (error)
        return reply({ error: "This listing is unavailable or reserved by another buyer." }, 409);
      // A timeout never releases a possibly payable session. Recovery checks Stripe.
      const checkout = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          payment_method_types: ["card"],
          expires_at: Math.floor(Date.now() / 1000) + 1800,
          customer_email: user.email,
          success_url: `${studioSiteUrl()}/market.html?purchase=${reservation.purchaseId}`,
          cancel_url: `${studioSiteUrl()}/market.html`,
          metadata: { kind: "secondary", market_purchase_id: reservation.purchaseId },
          payment_intent_data: {
            application_fee_amount: reservation.feeCents,
            transfer_data: { destination: reservation.destination },
            metadata: { kind: "secondary", market_purchase_id: reservation.purchaseId },
          },
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: "usd",
                unit_amount: reservation.priceCents,
                product_data: {
                  name: `${reservation.tier} edition #${reservation.mintNumber} — secondary sale`,
                  description:
                    "Transfer of the studio-recorded edition holder. Underlying artwork remains nonexclusive. Existing downloaded copies cannot be recalled.",
                },
              },
            },
          ],
        },
        { idempotencyKey: `market-checkout-${reservation.purchaseId}` },
      );
      const { error: saveError } = await db
        .from("market_purchases")
        .update({ checkout_session_id: checkout.id })
        .eq("id", reservation.purchaseId);
      if (saveError || !checkout.url) throw new Error("Checkout linkage needs recovery");
      return reply({ checkoutUrl: checkout.url, purchaseId: reservation.purchaseId }, 201);
    }
    return reply({ error: "Invalid marketplace action." }, 400);
  } catch (error) {
    console.error("Marketplace request failed", error instanceof Error ? error.message : "unknown");
    return reply(
      { error: "Marketplace request unavailable. Please try again or contact the studio." },
      500,
    );
  }
});
