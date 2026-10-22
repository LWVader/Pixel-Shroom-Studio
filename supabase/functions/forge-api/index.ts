import { printsEnabled, printMode } from "../_shared/gelato.ts";
import { corsFor, json, service } from "../_shared/common.ts";
const uuid = (v: unknown) =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsFor(request) });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, request);
  const reply = (data: unknown, status = 200) => json(data, status, request);
  try {
    const body = await request.json(),
      db = service();
    if (body.action === "availability") {
      const { data, error } = await db.rpc("foil_catalog");
      if (error) throw error;
      const edition = (data || []).find((e: any) => String(e.artworkId) === String(body.artworkId));
      if (!edition)
        return reply({
          edition: null,
          previews: [],
          digitalEnabled: false,
          canvasEnabled: false,
          forgeEnabled: Deno.env.get("FORGE_ENABLED") === "true",
        });
      const mappings = await db
        .from("gelato_products")
        .select("edition_tier")
        .eq("edition_artwork_id", Number(body.artworkId))
        .eq("kind", "canvas")
        .eq("active", true)
        .eq("print_ready", true);
      const { data: images, error: ie } = await db
        .from("foil_tier_assets")
        .select("tier,width,height,mime_type,preview_path")
        .eq("listing_id", Number(body.artworkId));
      if (ie) throw ie;
      const previews = (images || []).map((i: any) => ({
        tier: i.tier,
        width: i.width,
        height: i.height,
        mimeType: i.mime_type,
        previewUrl: i.preview_path
          ? db.storage.from("previews").getPublicUrl(i.preview_path).data.publicUrl
          : null,
      }));
      const key = Deno.env.get("STRIPE_SECRET_KEY") || "";
      const paymentReady =
        /^sk_(test|live)_/.test(key) &&
        (key.startsWith("sk_test_") || Deno.env.get("FORGE_PRINT_TAX_ENABLED") === "true");
      const open =
        paymentReady &&
        Deno.env.get("FORGE_PRINT_ENABLED") === "true" &&
        Deno.env.get("FOIL_CHECKOUT_ENABLED") === "true" &&
        edition?.enabled === true &&
        previews.length === 6 &&
        previews.every((p: any) => p.previewUrl);
      return reply({
        edition: edition || null,
        previews,
        digitalEnabled: open,
        canvasEnabled:
          open &&
          !mappings.error &&
          new Set((mappings.data || []).map((p: any) => p.edition_tier)).size === 6 &&
          Deno.env.get("FORGE_PRINT_CANVAS_ENABLED") === "true" &&
          printsEnabled() &&
          String(Deno.env.get("STRIPE_SECRET_KEY") || "").startsWith("sk_test_") ===
            (printMode() === "sandbox"),
        forgeEnabled: Deno.env.get("FORGE_ENABLED") === "true",
      });
    }
    const bearer = request.headers.get("Authorization")?.replace(/^Bearer /i, "") || "";
    const {
      data: { user },
      error: authError,
    } = await db.auth.getUser(bearer);
    if (authError || !user) return reply({ error: "Sign in to My Vault first." }, 401);
    if (body.action === "forge") {
      if (Deno.env.get("FORGE_ENABLED") !== "true")
        return reply({ error: "The Forge is not open yet. Your editions are unchanged." }, 503);
      if (
        !uuid(body.requestId) ||
        !Array.isArray(body.mintIds) ||
        body.mintIds.length < 2 ||
        body.mintIds.length > 5 ||
        !body.mintIds.every(uuid)
      )
        return reply({ error: "Choose the exact recipe inputs." }, 400);
      const { data, error } = await db.rpc("forge_edition", {
        holder: user.id,
        input_ids: body.mintIds,
        operation_key: body.requestId,
      });
      if (error)
        return reply(
          {
            error:
              "The upgrade could not be completed. Inputs must be distinct, eligible digital-only editions of one artwork and tier, with output stock available.",
          },
          409,
        );
      return reply(data);
    }
    if (body.action === "inventory") {
      const { data, error } = await db
        .from("mints")
        .select(
          "id,listing_id,tier,mint_number,state,market_frozen,forge_consumed_at,foil_listings(master_title),orders!inner(status)",
        )
        .eq("owner_id", user.id)
        .eq("orders.status", "paid")
        .eq("state", "ready")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      const ids = (data || []).map((m: any) => m.id);
      if (!ids.length)
        return reply({
          items: [],
          forgeEnabled: Deno.env.get("FORGE_ENABLED") === "true",
          hasMore: false,
        });
      const claims = await db.from("canvas_claims").select("mint_id,state").in("mint_id", ids);
      const prints = await db
        .from("gelato_orders")
        .select("edition_mint_id,fulfillment_state")
        .in("edition_mint_id", ids)
        .neq("fulfillment_state", "canceled");
      const listings = await db
        .from("secondary_market")
        .select("mint_id")
        .in("mint_id", ids)
        .in("status", ["preparing", "active", "reserved", "frozen"]);
      if (claims.error || prints.error || listings.error) throw new Error("Inventory unavailable");
      return reply({
        forgeEnabled: Deno.env.get("FORGE_ENABLED") === "true",
        hasMore: data.length === 1000,
        items: data.map((m: any) => ({
          id: m.id,
          artworkId: m.listing_id,
          tier: m.tier,
          mintNumber: m.mint_number,
          title: m.foil_listings?.master_title || "Edition",
          eligible:
            !m.market_frozen &&
            !m.forge_consumed_at &&
            !claims.data?.some((c: any) => c.mint_id === m.id) &&
            !prints.data?.some((p: any) => p.edition_mint_id === m.id) &&
            !listings.data?.some((p: any) => p.mint_id === m.id),
          consumed: Boolean(m.forge_consumed_at),
          canvasClaim: claims.data?.find((c: any) => c.mint_id === m.id)?.state || null,
        })),
      });
    }
    return reply({ error: "Unknown action." }, 400);
  } catch {
    return reply(
      { error: "Forge & Print is temporarily unavailable. Your editions are safe in My Vault." },
      503,
    );
  }
});
