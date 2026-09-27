// SECTION: Supabase clients and CORS
import { createClient } from "npm:@supabase/supabase-js@2";

const siteUrl = (Deno.env.get("SITE_URL") || "").replace(/\/$/, "");
const cors = {
  "Access-Control-Allow-Origin": siteUrl,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authorization = request.headers.get("Authorization") || "";
    if (!authorization.startsWith("Bearer ")) return json({ error: "Authentication required." }, 401);

    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: userError } = await caller.auth.getUser();
    if (userError || !user) return json({ error: "Authentication required." }, 401);

    const service = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: administrator } = await service
      .from("admin_users")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!administrator) return json({ error: "Administrator access required." }, 403);

    const { email } = await request.json();
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return json({ error: "Enter a valid administrator email." }, 400);
    }

    const { data: invitation, error: inviteError } = await service.auth.admin.inviteUserByEmail(
      normalizedEmail,
      { redirectTo: `${siteUrl}/admin.html` },
    );
    if (inviteError) throw inviteError;
    if (!invitation.user) throw new Error("Supabase did not return the invited user.");

    const { error: roleError } = await service.from("admin_users").upsert({
      user_id: invitation.user.id,
    });
    if (roleError) throw roleError;

    return json({ invited: true });
  } catch (error) {
    console.error("Add administrator failed:", error);
    return json({ error: error instanceof Error ? error.message : "Administrator invitation failed." }, 500);
  }
});

