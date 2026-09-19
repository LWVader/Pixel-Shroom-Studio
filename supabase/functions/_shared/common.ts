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

// SECTION: Cross-origin requests from the live storefront
const siteUrl = (Deno.env.get("SITE_URL") || "*").replace(/\/$/, "");

export const cors = {
  "Access-Control-Allow-Origin": siteUrl,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, stripe-signature, paypal-auth-algo, paypal-cert-url, paypal-transmission-id, paypal-transmission-sig, paypal-transmission-time",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// SECTION: Consistent JSON responses
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

// SECTION: Private buyer access-token generation
export function randomToken(): string {
  return (
    crypto.randomUUID().replaceAll("-", "") +
    crypto.randomUUID().replaceAll("-", "")
  );
}

// SECTION: One-way token hashing
export async function sha256(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
