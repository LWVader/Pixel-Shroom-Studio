import { inspectStoredPrint, validatePrintMapping } from "../_shared/print-preflight.ts";
import Stripe from "npm:stripe@18";
import { corsFor, json, service, studioSiteUrl } from "../_shared/common.ts";
import {
  PRINT_BUCKET,
  printsEnabled,
  printMode,
  livePrintsAllowed,
  gelatoRequest,
  privatePrintUrl,
  refreshPrintOrder,
  submitPaidPrint,
} from "../_shared/gelato.ts";
import { recipientFor, quotePayload, shippingOptions } from "../_shared/gelato-core.ts";
const uuid = (value: any) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const publicOrder = (o: any) => ({
  id: o.id,
  title: o.product_snapshot.title,
  variant: o.product_snapshot.variant_label,
  quantity: o.quantity,
  paymentState: o.payment_state,
  state: o.fulfillment_state,
  status: o.gelato_status || "",
  tracking: o.tracking || [],
  testMode: o.test_mode,
  createdAt: o.created_at,
});
Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsFor(request) });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, request);
  const reply = (data: unknown, status = 200) => json(data, status, request);
  try {
    const db = service();
    const body = await request.json();
    if (body.action === "catalog" && !body.mintId) {
      const { data, error } = await db.from("gelato_storefront_products").select("*").limit(100);
      if (error) throw error;
      return reply({
        products: data || [],
        enabled: printsEnabled(),
        testMode: printMode() === "sandbox",
        countries: ["US"],
      });
    }
    const bearer = request.headers.get("Authorization")?.replace(/^Bearer /i, "") || "";
    const {
      data: { user },
      error: authError,
    } = await db.auth.getUser(bearer);
    if (authError || !user) return reply({ error: "Sign in to your studio account first." }, 401);
    if (body.action === "catalog" && body.mintId) {
      if (!uuid(body.mintId)) return reply({ error: "Invalid edition." }, 400);
      const { data: m, error: me } = await db
        .from("mints")
        .select("listing_id,tier,state,market_frozen,forge_consumed_at,orders!inner(status)")
        .eq("id", body.mintId)
        .eq("owner_id", user.id)
        .eq("orders.status", "paid")
        .single();
      if (me || !m || m.state !== "ready" || m.market_frozen || m.forge_consumed_at)
        return reply({ error: "This edition is unavailable for printing." }, 409);
      const { data: products, error } = await db
        .from("gelato_products")
        .select("id,title,kind,variant_label,preview_url,retail_cents")
        .eq("edition_artwork_id", m.listing_id)
        .eq("edition_tier", m.tier)
        .eq("kind", "canvas")
        .eq("active", true)
        .eq("print_ready", true);
      if (error) throw error;
      const { data: claim } = await db
        .from("canvas_claims")
        .select("state")
        .eq("mint_id", body.mintId)
        .maybeSingle();
      return reply({
        products: (products || []).map((p: any) => ({
          ...p,
          retail_cents: claim?.state === "available" ? 0 : p.retail_cents,
        })),
        enabled: printsEnabled(),
        testMode: printMode() === "sandbox",
        canvasClaim: claim?.state || null,
        countries: ["US"],
      });
    }
    if (body.action === "orders") {
      const { data, error } = await db
        .from("gelato_orders")
        .select("*")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return reply({ orders: (data || []).map(publicOrder) });
    }
    if (body.action === "order") {
      if (!uuid(body.orderId)) return reply({ error: "Invalid order." }, 400);
      const { data, error } = await db
        .from("gelato_orders")
        .select("*")
        .eq("id", body.orderId)
        .eq("owner_id", user.id)
        .single();
      if (error || !data) return reply({ error: "Order not found." }, 404);
      // Refresh only known provider orders. Ambiguous create requests require owner reconciliation.
      const order = data.gelato_id ? await refreshPrintOrder(db, data) : data;
      return reply({ order: publicOrder(order) });
    }
    if (String(body.action).startsWith("admin_")) {
      const { data: admin } = await db
        .from("admin_users")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!admin) return reply({ error: "Admin access required." }, 403);
      if (body.action === "admin_list") {
        const products = await db
          .from("gelato_products")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100);
        const orders = await db
          .from("gelato_orders")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(50);
        if (products.error || orders.error) throw products.error || orders.error;
        return reply({ products: products.data, orders: (orders.data || []).map(publicOrder) });
      }
      if (body.action === "admin_upload") {
        if (!uuid(body.productId) || !["png", "jpg", "pdf"].includes(body.extension))
          return reply({ error: "Invalid source upload." }, 400);
        const path = `gelato/${body.productId}/${crypto.randomUUID()}.${body.extension}`;
        const { data, error } = await db.storage.from(PRINT_BUCKET).createSignedUploadUrl(path);
        if (error) throw error;
        return reply({ path, token: data.token });
      }
      if (body.action === "admin_inspect") {
        if (!uuid(body.productId)) return reply({ error: "Invalid product." }, 400);
        const { data: product, error } = await db
          .from("gelato_products")
          .select("print_path")
          .eq("id", body.productId)
          .single();
        if (error || !product) return reply({ error: "Product not found." }, 404);
        return reply({ facts: await inspectStoredPrint(db, product.print_path) });
      }
      if (body.action === "admin_save") {
        const p = body.product;
        const preview = new URL(String(p?.preview_url || ""));
        const allowedPreview = new Set([
          new URL(studioSiteUrl()).origin,
          new URL(Deno.env.get("SUPABASE_URL")!).origin,
        ]);
        if (
          !uuid(p?.id) ||
          !["canvas", "apparel"].includes(p.kind) ||
          typeof p.title !== "string" ||
          p.title.trim().length < 1 ||
          p.title.length > 160 ||
          typeof p.variant_label !== "string" ||
          p.variant_label.length < 1 ||
          p.variant_label.length > 160 ||
          typeof p.product_uid !== "string" ||
          !/^[-a-zA-Z0-9_]{5,500}$/.test(p.product_uid) ||
          !/^txcd_[0-9]{8}$/.test(p.stripe_tax_code) ||
          !Number.isInteger(p.retail_cents) ||
          p.retail_cents < 100 ||
          p.retail_cents > 1000000 ||
          (preview.origin === new URL(Deno.env.get("SUPABASE_URL")!).origin &&
            !preview.pathname.startsWith("/storage/v1/object/public/previews/")) ||
          preview.protocol !== "https:" ||
          preview.username ||
          preview.password ||
          !allowedPreview.has(preview.origin) ||
          !new RegExp(`^gelato/${p.id}/[0-9a-f-]{36}\\.(png|jpg|pdf)$`).test(p.print_path) ||
          typeof p.active !== "boolean"
        )
          return reply(
            {
              error:
                "Review the product mapping, print-ready confirmation and public studio preview.",
            },
            400,
          );
        const folder = p.print_path.slice(0, p.print_path.lastIndexOf("/")),
          filename = p.print_path.split("/").at(-1);
        const { data: objects, error: objectError } = await db.storage
          .from(PRINT_BUCKET)
          .list(folder, { search: filename });
        if (objectError || !objects?.some((o: any) => o.name === filename))
          throw new Error("Upload the private print-ready source first.");
        const { facts, report } = await validatePrintMapping(db, p);
        if (p.edition_artwork_id != null) {
          if (
            !Number.isSafeInteger(p.edition_artwork_id) ||
            p.edition_artwork_id < 1 ||
            !["Standard", "Silver", "Gold", "Emerald", "Sapphire", "Prismatic"].includes(
              p.edition_tier,
            ) ||
            p.kind !== "canvas"
          )
            return reply(
              { error: "Choose a valid artwork ID and tier for this canvas mapping." },
              400,
            );
          const framed = ["Emerald", "Sapphire", "Prismatic"].includes(p.edition_tier);
          if (report.specs.width !== 16 || report.specs.height !== (framed ? 20 : 16))
            return reply(
              { error: "Edition canvases require 16 × 16, or 16 × 20 portrait for framed tiers." },
              400,
            );
        }
        const row = {
          edition_artwork_id: p.edition_artwork_id ?? null,
          edition_tier: p.edition_artwork_id != null ? p.edition_tier : null,
          id: p.id,
          title: p.title.trim(),
          kind: p.kind,
          variant_label: p.variant_label,
          product_uid: p.product_uid,
          preview_url: preview.href,
          print_path: p.print_path,
          stripe_tax_code: p.stripe_tax_code,
          retail_cents: p.retail_cents,
          active: p.active === true,
          print_ready: report.state === "ready" && p.print_ready === true,
          print_specs: report.specs,
          preflight_report: {
            ...report,
            facts,
            productUid: p.product_uid,
            printPath: p.print_path,
            reviews: p.preflight_reviews,
            checkedAt: new Date().toISOString(),
            checkedBy: user.id,
          },
        };
        const { error } = await db.from("gelato_products").upsert(row);
        if (error) throw error;
        return reply({ saved: true });
      }
      if (body.action === "admin_reconcile") {
        if (!uuid(body.orderId)) return reply({ error: "Invalid order." }, 400);
        const { data, error } = await db
          .from("gelato_orders")
          .select("*")
          .eq("id", body.orderId)
          .single();
        if (error || !data) throw new Error("Order not found.");
        if (data.payment_state === "paid" && data.fulfillment_state === "queued" && printsEnabled())
          await submitPaidPrint(db, data.id);
        const current = (await db.from("gelato_orders").select("*").eq("id", data.id).single())
          .data;
        return reply({ order: publicOrder(await refreshPrintOrder(db, current)) });
      }
      return reply({ error: "Unknown admin action." }, 400);
    }
    if (!printsEnabled())
      return reply({ error: "Physical checkout is not open yet. Please contact the studio." }, 503);
    if (body.action === "quote") {
      if (!uuid(body.productId) || body.consent !== true)
        return reply(
          { error: "Choose a product and agree to delivery-data sharing for the quote." },
          400,
        );
      const quantity = Number(body.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10)
        return reply({ error: "Quantity must be 1–10." }, 400);
      const recipient = recipientFor(body.recipient, user.email || "");
      let { data: product, error } = await db
        .from("gelato_products")
        .select("*")
        .eq("id", body.productId)
        .eq("active", true)
        .eq("print_ready", true)
        .single();
      if (error || !product) throw new Error("Product unavailable.");
      let claimMintId = null;
      if (product.edition_artwork_id != null || body.mintId) {
        if (!uuid(body.mintId) || quantity !== 1)
          return reply({ error: "Choose one owned edition from My Vault." }, 400);
        const { data: m, error: me } = await db
          .from("mints")
          .select("id,listing_id,tier,state,market_frozen,forge_consumed_at,orders!inner(status)")
          .eq("id", body.mintId)
          .eq("owner_id", user.id)
          .eq("orders.status", "paid")
          .single();
        if (
          me ||
          !m ||
          m.state !== "ready" ||
          m.market_frozen ||
          m.forge_consumed_at ||
          m.listing_id !== product.edition_artwork_id ||
          m.tier !== product.edition_tier
        )
          return reply({ error: "This product does not match an eligible edition you own." }, 409);
        const { data: claim, error: ce } = await db
          .from("canvas_claims")
          .select("state")
          .eq("mint_id", m.id)
          .maybeSingle();
        if (ce) throw ce;
        if (claim && claim.state !== "available")
          return reply({ error: "This included canvas is already used or held for review." }, 409);
        if (claim?.state === "available") {
          claimMintId = m.id;
          product = { ...product, retail_cents: 0, claimMintId };
        }
      }
      const id = crypto.randomUUID();
      const { error: insertError } = await db.from("gelato_quotes").insert({
        id,
        edition_mint_id: body.mintId || null,
        owner_id: user.id,
        product_id: product.id,
        product_snapshot: product,
        quantity,
        recipient,
        test_mode: printMode() === "sandbox",
      });
      if (insertError) throw insertError;
      try {
        const source = await privatePrintUrl(db, product.print_path);
        const response = await gelatoRequest(
          "orders:quote",
          quotePayload(id, user.id, product, quantity, recipient, source),
        );
        let options = shippingOptions(response, product, quantity);
        if (body.mintId) {
          const providerShipping = Object.fromEntries(options.map((s: any) => [s.uid, s.cents]));
          product = { ...product, providerShipping };
          options = options.map((s: any) => ({ ...s, cents: claimMintId ? 0 : 1349 }));
        }
        const { error: saveError } = await db
          .from("gelato_quotes")
          .update({ shipping_options: options, state: "ready", product_snapshot: product })
          .eq("id", id);
        if (saveError) throw saveError;
        return reply({
          quoteId: id,
          productCents: product.retail_cents * quantity,
          prepaid: Boolean(claimMintId),
          shipping: options,
          testMode: printMode() === "sandbox",
          expiresInSeconds: 900,
        });
      } catch (error) {
        await db.from("gelato_quotes").update({ state: "failed" }).eq("id", id);
        throw error;
      }
    }
    if (body.action === "checkout") {
      if (!uuid(body.quoteId) || typeof body.shippingMethod !== "string")
        return reply({ error: "Request a shipping quote first." }, 400);
      const { data: order, error } = await db.rpc("reserve_gelato_checkout", {
        target_quote: body.quoteId,
        buyer: user.id,
        shipping_method: body.shippingMethod,
      });
      if (error) throw error;
      if (order.payment_state !== "pending" && !order.product_snapshot.claimMintId)
        return reply({ error: "This quote already has a paid order. View My print orders." }, 409);
      if (order.product_snapshot.claimMintId) {
        const { data: redeemed, error: re } = await db.rpc("redeem_canvas_claim", {
          target_order: order.id,
          holder: user.id,
        });
        if (re)
          return reply(
            { error: "This canvas claim cannot be redeemed. No second payment was requested." },
            409,
          );
        await submitPaidPrint(db, redeemed.id);
        return reply({
          orderUrl: studioSiteUrl() + "/collection.html?tab=orders&order=" + redeemed.id,
          redeemed: true,
        });
      }
      const test = order.test_mode;
      const key =
        Deno.env.get("GELATO_STRIPE_SECRET_KEY") ||
        (printMode() === "live" ? Deno.env.get("STRIPE_SECRET_KEY") : "") ||
        "";
      if (
        (test && !key.startsWith("sk_test_")) ||
        (!test &&
          (!livePrintsAllowed() ||
            !key.startsWith("sk_live_") ||
            Deno.env.get("GELATO_STRIPE_TAX_READY") !== "true"))
      )
        return reply({ error: "Payment environment is not configured for this print order." }, 503);
      const stripe = new Stripe(key);
      const site = studioSiteUrl();
      if (order.stripe_session) {
        const existing = await stripe.checkout.sessions.retrieve(order.stripe_session);
        if (existing.status === "open" && existing.url) return reply({ checkoutUrl: existing.url });
        return reply(
          { error: "This checkout has ended. Request a new quote or check My print orders." },
          409,
        );
      }
      const address = {
        line1: order.recipient.addressLine1,
        line2: order.recipient.addressLine2 || undefined,
        city: order.recipient.city,
        state: order.recipient.state,
        postal_code: order.recipient.postCode,
        country: "US",
      };
      const customer = await stripe.customers.create(
        {
          email: order.recipient.email,
          name: order.recipient.firstName + " " + order.recipient.lastName,
          address,
          shipping: { name: order.recipient.firstName + " " + order.recipient.lastName, address },
          metadata: { print_order_id: order.id },
        },
        { idempotencyKey: "gelato-customer-" + order.id },
      );
      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          payment_method_types: ["card"],
          customer: customer.id,
          client_reference_id: order.id,
          metadata: { kind: "gelato", print_order_id: order.id },
          automatic_tax: { enabled: !test },
          shipping_options: [
            {
              shipping_rate_data: {
                display_name: "Quoted delivery",
                type: "fixed_amount",
                fixed_amount: { amount: order.shipping_cents, currency: "usd" },
                tax_behavior: "exclusive",
                tax_code: "txcd_92010001",
              },
            },
          ],
          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount: order.product_snapshot.retail_cents,
                tax_behavior: "exclusive",
                product_data: {
                  name: order.product_snapshot.title + " · " + order.product_snapshot.variant_label,
                  tax_code: order.product_snapshot.stripe_tax_code,
                  description: `Physical product. Ships to ${order.recipient.city}, ${order.recipient.state} ${order.recipient.postCode}, US. No digital download.`,
                },
              },
              quantity: order.quantity,
            },
          ],
          success_url:
            site +
            (order.edition_mint_id
              ? "/collection.html?tab=orders&order="
              : "/print-orders.html?order=") +
            order.id,
          cancel_url:
            site +
            (order.product_snapshot.kind === "canvas" ? "/canvases.html" : "/apparel.html") +
            "?checkout=canceled",
          expires_at: Math.floor(Date.parse(order.created_at) / 1000) + 3600,
        },
        { idempotencyKey: "gelato-checkout-" + order.id },
      );
      const { error: saveError } = await db
        .from("gelato_orders")
        .update({ stripe_session: session.id })
        .eq("id", order.id);
      if (saveError) throw saveError;
      if (!session.url) throw new Error("Checkout URL unavailable.");
      return reply({ checkoutUrl: session.url });
    }
    return reply({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error("Print request failed:", error instanceof Error ? error.name : "Error");
    return reply(
      {
        error: error instanceof Error ? error.message : "The print request could not be completed.",
      },
      400,
    );
  }
});
