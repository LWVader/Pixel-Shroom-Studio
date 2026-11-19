import {authenticatedAdmin} from "./lib/admin-access.mjs";
import {handleSocial} from "./lib/ad-studio-social.mjs";
import {createCampaignOrders, sessionPattern} from "./lib/campaign-orders.mjs";
import {campaignStore} from "./lib/campaign-store.mjs";
import {stripeApi} from "./lib/stripe-api.mjs";

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

function json(data, status = 200) {
  return Response.json(data, {status, headers: apiHeaders});
}

function apiError(message, status) {
  return json({error: message}, status);
}

function methodNotAllowed(allow) {
  return new Response(null, {status: 405, headers: {...apiHeaders, Allow: allow}});
}

function sameOriginJson(request, url) {
  return request.headers.get("Origin") === url.origin &&
    request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() === "application/json";
}

async function readJson(request) {
  const reader = request.body?.getReader();
  if (!reader) throw {error: "The request was empty.", status: 400};
  const buffer = new Uint8Array(12000);
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      if (size + value.byteLength > buffer.length) {
        await reader.cancel();
        throw {error: "This request is too large.", status: 413};
      }
      buffer.set(value, size);
      size += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(new TextDecoder().decode(buffer.subarray(0, size)));
  } catch {
    throw {error: "This request could not be read.", status: 400};
  }
}

function routeFailure(error, message) {
  if (typeof error?.error === "string" && Number.isInteger(error.status)) {
    return apiError(error.error, error.status);
  }
  console.error(message);
  return apiError(message, 503);
}

function billingPortal(value) {
  try {
    const url = new URL(value);
    return url.origin === "https://billing.stripe.com" && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}

async function notifyBrief(env, record) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) return;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json"},
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to: [env.ADMIN_ALERT_EMAIL || "lwvader@pixelshroomstudio.com"],
      reply_to: record.buyer_email,
      subject: "New Pixel Shroom Studio campaign brief",
      text: `Offer: ${record.offer}\nBusiness: ${record.business}\nIndustry: ${record.industry}\nVibe: ${record.vibe}\nColors: ${record.colors || "No preference"}\n\nCampaign goal\n${record.goal}`
    }),
    signal: AbortSignal.timeout(8000),
    redirect: "error"
  });
  if (!response.ok) throw new Error("Email notification rejected.");
}

async function buyerRoute(request, env, url) {
  if (request.method !== "POST") return methodNotAllowed("POST");
  if (!sameOriginJson(request, url)) return apiError("Open the campaign page to continue.", 403);
  try {
    const input = await readJson(request);
    if (input?.action === "download") return apiError("Campaign ZIPs are sent by email.", 410);
    const portal = billingPortal(env.CAMPAIGN_BILLING_PORTAL_URL);
    const ready = Boolean(env.STRIPE_SECRET_KEY && env.CAMPAIGN_DB);
    const options = {
      attention: ready && env.CAMPAIGN_ATTENTION_ENABLED === "true",
      landing: ready && env.CAMPAIGN_LANDING_ENABLED === "true",
      monthlyPrice: ready && portal ? env.CAMPAIGN_MONTHLY_PRICE_ID : "",
      billingPortal: portal,
      site: new URL(env.CAMPAIGN_SITE_URL || url.origin).origin
    };
    if (input?.action === "offers") {
      return json({attention: options.attention, monthly: Boolean(options.monthlyPrice), billingPortal: portal});
    }
    if (!ready) return apiError("Online checkout is temporarily unavailable.", 503);
    const handle = createCampaignOrders({
      stripe: stripeApi(env.STRIPE_SECRET_KEY),
      store: campaignStore(env.CAMPAIGN_DB),
      options,
      notify: (record) => notifyBrief(env, record)
    });
    return json(await handle(input));
  } catch (error) {
    return routeFailure(error, "Your request could not be completed. Try again or email the studio for help.");
  }
}

async function adminCampaignRoute(request, env, url) {
  if (!["GET", "POST"].includes(request.method)) return methodNotAllowed("GET, POST");
  if (request.method === "POST" && !sameOriginJson(request, url)) return apiError("Same-origin requests required.", 403);
  if (!env.CAMPAIGN_DB) return apiError("Campaign storage is temporarily unavailable.", 503);
  const store = campaignStore(env.CAMPAIGN_DB);
  try {
    if (request.method === "GET") {
      const offset = Number(url.searchParams.get("offset") ?? 0);
      if (!Number.isSafeInteger(offset) || offset < 0) return apiError("Invalid order offset.", 400);
      return json(await store.list(offset));
    }
    const {sessionId, previous} = await readJson(request) ?? {};
    if (typeof sessionId !== "string" || !sessionPattern.test(sessionId) ||
        !(previous === null || (typeof previous === "string" && previous.length <= 40 && Number.isFinite(Date.parse(previous))))) {
      return apiError("Invalid order or delivery date.", 400);
    }
    const status = await store.recordEmailSent(sessionId, previous);
    return status ? json(status) : apiError("Campaign brief not found.", 404);
  } catch (error) {
    return routeFailure(error, "Could not update Campaign Admin. Please try again.");
  }
}

const socialMethods = new Map([["config", "GET"], ["status", "GET"], ["connect", "POST"], ["publish", "POST"]]);

async function socialRoute(request, env, url, user) {
  const action = url.pathname.slice("/api/ad-studio/social/".length);
  const method = socialMethods.get(action);
  if (!method) return apiError("Unknown publishing action.", 404);
  if (request.method !== method) return methodNotAllowed(method);
  if (method === "POST" && request.headers.get("Origin") !== url.origin) {
    return apiError("Same-origin requests required.", 403);
  }
  if (!env.AD_STUDIO_DB) return apiError("Connect the AD Studio database to enable social publishing.", 503);
  const headers = new Headers(request.headers);
  headers.set("oai-authenticated-user-id", env.AD_STUDIO_LEGACY_USER_ID || user.id);
  headers.set("oai-authenticated-user-email", user.email);
  return handleSocial(new Request(request, {headers}), {...env, DB: env.AD_STUDIO_DB}, action);
}

function adminResponse(response, isEditor) {
  const result = new Response(response.body, response);
  if (isEditor) {
    result.headers.set("Content-Security-Policy", [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob: data:",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'"
    ].join("; "));
  }
  for (const [key, value] of Object.entries(apiHeaders)) result.headers.set(key, value);
  result.headers.set("X-Robots-Tag", "noindex, nofollow");
  return result;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (aliases.has(url.hostname) || (url.hostname === canonicalHost && url.protocol !== "https:")) {
      url.protocol = "https:";
      url.hostname = canonicalHost;
      return Response.redirect(url, 308);
    }

    // All packaged routes and asset names are ASCII. Reject encoded aliases before
    // access checks so the assets binding cannot resolve an alternate admin URL.
    if (!/^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]*$/.test(url.pathname)) {
      return apiError("Page not found.", 404);
    }
    if (url.pathname === "/api/campaign-orders") return buyerRoute(request, env, url);

    const isAdmin = url.pathname === "/admin.html";
    const isEditor = url.pathname.startsWith("/admin-ad-studio/");
    const isAdminApi = url.pathname === "/api/admin/campaigns";
    const isSocialApi = url.pathname.startsWith("/api/ad-studio/social/");
    if (isAdmin || isEditor || isAdminApi || isSocialApi) {
      const user = await authenticatedAdmin(request, env);
      if (!user) return apiError("Cloudflare Access administrator sign-in required.", 401);
      if (isAdminApi) return adminCampaignRoute(request, env, url);
      if (isSocialApi) return socialRoute(request, env, url, user);
    }

    if (!["GET", "HEAD"].includes(request.method)) return methodNotAllowed("GET, HEAD");
    const target = retargeted.get(url.pathname);
    if (target) return Response.redirect(new URL(target, url.origin), 302);
    if (url.pathname === "/") url.pathname = "/index.html";
    if (url.pathname === "/admin-ad-studio/") url.pathname = "/admin-ad-studio/index.html";
    const response = await env.ASSETS.fetch(new Request(url, request));
    return isAdmin || isEditor ? adminResponse(response, isEditor && url.pathname.endsWith(".html")) : response;
  }
};
