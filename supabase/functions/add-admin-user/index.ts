// SECTION: Supabase clients and CORS
import { createClient } from "npm:@supabase/supabase-js@2";

import { corsFor, json, studioSiteUrl } from "../_shared/common.ts";
const siteUrl = studioSiteUrl();

Deno.serve(async (request: Request): Promise<Response> => {
  const respond = (data: unknown, status = 200) => json(data, status, request);
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsFor(request) });
  if (request.method !== "POST") return respond({ error: "Method not allowed." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authorization = request.headers.get("Authorization") || "";
    if (!authorization.startsWith("Bearer ")) return respond({ error: "Authentication required." }, 401);

    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: userError } = await caller.auth.getUser();
    if (userError || !user) return respond({ error: "Authentication required." }, 401);

    const service = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: administrator } = await service
      .from("admin_users")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!administrator) return respond({ error: "Administrator access required." }, 403);

    const { email } = await request.json();
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return respond({ error: "Enter a valid administrator email." }, 400);
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

    return respond({ invited: true });
  } catch (error) {
    console.error("Add administrator failed:", error);
    return respond({ error: error instanceof Error ? error.message : "Administrator invitation failed." }, 500);
  }
});

