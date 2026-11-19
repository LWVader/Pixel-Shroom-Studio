import {adminProject, authenticatedAdmin} from "./lib/admin-access.mjs";
import {handleSocial} from "./lib/ad-studio-social.mjs";

const canonicalHost = "www.pixelshroomstudio.com";
const aliases = new Set(["pixelshroomstudio.com", "pixel-shroom-studio.phantasmocazdor.workers.dev"]);
const retargeted = new Map([
  ["/index.html", "/"],
  ["/admin", "/admin.html"],
  ["/admin/", "/admin.html"],
  ["/admin-ad-studio", "/admin-ad-studio/"],
  ["/work", "/#work"],
  ["/contact", "/#contact"],
  ["/contact.html", "/#contact"]
]);
const apiHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff"
};

function adminResponse(response, env, isEditor) {
  const result = new Response(response.body, response);
  let connect = "'self'";
  try {
    connect += " " + adminProject(env).origin;
  } catch {
    // A misconfigured project leaves the login disabled until configuration is corrected.
  }
  const images = isEditor ? "'self' data: blob: https:" : "'self'";
  result.headers.set("Content-Security-Policy", [
    "default-src 'self'",
    "script-src 'self' https://esm.sh",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    `img-src ${images}`,
    "media-src 'self' blob: data:",
    `connect-src ${connect}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'"
  ].join("; "));
  result.headers.set("Cache-Control", "no-store");
  result.headers.set("Referrer-Policy", "no-referrer");
  result.headers.set("X-Robots-Tag", "noindex, nofollow");
  return result;
}

function apiError(message, status) {
  return Response.json({error: message}, {status, headers: apiHeaders});
}

async function socialRoute(request, env, url) {
  const action = url.pathname.slice("/api/ad-studio/social/".length);
  const method = new Map([["config", "GET"], ["status", "GET"], ["connect", "POST"], ["publish", "POST"]]).get(action);
  if (!method) return apiError("Unknown publishing action.", 404);
  if (request.method !== method) return apiError("Method not allowed.", 405);
  if (method === "POST" && request.headers.get("Origin") !== url.origin) {
    return apiError("Same-origin requests required.", 403);
  }
  try {
    const user = await authenticatedAdmin(request, adminProject(env));
    if (!user) return apiError("Administrator sign-in required.", 401);
    if (!env.AD_STUDIO_DB) return apiError("Connect the AD Studio database to enable social publishing.", 503);
    const headers = new Headers(request.headers);
    headers.set("oai-authenticated-user-id", user.id);
    headers.set("oai-authenticated-user-email", user.email || "");
    return await handleSocial(new Request(request, {headers}), {...env, DB: env.AD_STUDIO_DB}, action);
  } catch {
    return apiError("Could not verify your administrator session. Please retry.", 503);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (aliases.has(url.hostname) || (url.hostname === canonicalHost && url.protocol !== "https:")) {
      url.protocol = "https:";
      url.hostname = canonicalHost;
      return Response.redirect(url, 308);
    }
    if (url.pathname.startsWith("/api/ad-studio/social/")) return socialRoute(request, env, url);
    if (url.pathname === "/admin-config.js") {
      if (!["GET", "HEAD"].includes(request.method)) return apiError("Method not allowed.", 405);
      let script;
      try {
        const {origin, key} = adminProject(env);
        script = `export const SUPABASE_URL = ${JSON.stringify(origin)}; export const SUPABASE_ANON_KEY = ${JSON.stringify(key)};`;
      } catch {
        script = "export const SUPABASE_URL = ''; export const SUPABASE_ANON_KEY = '';";
      }
      return new Response(request.method === "HEAD" ? null : script, {
        headers: {...apiHeaders, "Content-Type": "text/javascript; charset=utf-8"}
      });
    }
    if (url.pathname === "/api/campaign-orders") {
      if (request.method !== "POST") {
        return new Response(null, {status: 405, headers: {...apiHeaders, Allow: "POST"}});
      }
      if (request.headers.get("Origin") !== url.origin || !request.headers.get("Content-Type")?.startsWith("application/json")) {
        return Response.json({error: "Open the campaign page to continue."}, {status: 403, headers: apiHeaders});
      }
      try {
        const endpoint = new URL("/functions/v1/campaign-orders", env.CAMPAIGN_SUPABASE_URL);
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Campaign-Proxy-Key": env.CAMPAIGN_PROXY_KEY || ""
          },
          body: request.body,
          redirect: "error"
        });
        return new Response(response.body, {
          status: response.status,
          headers: {...apiHeaders, "Content-Type": "application/json; charset=utf-8"}
        });
      } catch {
        return Response.json({error: "Online checkout is temporarily unavailable."}, {status: 503, headers: apiHeaders});
      }
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, {status: 405, headers: {Allow: "GET, HEAD"}});
    }
    const target = retargeted.get(url.pathname);
    if (target) return Response.redirect(new URL(target, url.origin), 302);
    if (url.pathname === "/") url.pathname = "/index.html";
    if (url.pathname === "/admin-ad-studio/") url.pathname = "/admin-ad-studio/index.html";
    const response = await env.ASSETS.fetch(new Request(url, request));
    if (response.status === 404 && env.LEGACY_STUDIO) {
      return env.LEGACY_STUDIO.fetch(request);
    }
    if (url.pathname === "/admin.html" || url.pathname === "/admin-ad-studio/index.html") {
      return adminResponse(response, env, url.pathname !== "/admin.html");
    }
    return response;
  }
};
