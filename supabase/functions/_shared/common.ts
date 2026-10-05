// SECTION: Supabase service-role client
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export function service() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase service credentials are missing.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// Canonical production links; a staging SITE_URL remains supported.
export function studioSiteUrl(): string {
  const value = Deno.env.get("SITE_URL") || "https://www.pixelshroomstudio.com";
  const url = new URL(value);
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))
  )
    throw new Error("SITE_URL must use HTTPS.");
  if (
    ["pixelshroomstudio.com", "pixel-shroom-studio.phantasmocazdor.workers.dev"].includes(
      url.hostname,
    )
  )
    return "https://www.pixelshroomstudio.com";
  return url.origin;
}

export function corsFor(request?: Request): Record<string, string> {
  const allowed = new Set([
    studioSiteUrl(),
    "https://www.pixelshroomstudio.com",
    "https://pixelshroomstudio.com",
    "https://pixel-shroom-studio.phantasmocazdor.workers.dev",
  ]);
  const origin = request?.headers.get("Origin") || studioSiteUrl();
  return {
    "Access-Control-Allow-Origin": allowed.has(origin) ? origin : studioSiteUrl(),
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, stripe-signature",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
export const cors = corsFor();

export function json(data: unknown, status = 200, request?: Request): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsFor(request),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

// SECTION: Private buyer access-token generation
export function randomToken(): string {
  return crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
}

// SECTION: One-way token hashing
export async function sha256(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
