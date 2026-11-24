import {portfolioImage, portfolioItem, portfolioList, savePortfolio} from "./lib/portfolio.mjs";
import {authenticatedAdmin} from "./lib/admin-access.mjs";
import {clearPasswordSession, passwordAdmin, passwordConfigured, signInWithPassword} from "./lib/admin-session.mjs";
import {handleSocial} from "./lib/ad-studio-social.mjs";
import {createCampaignOrders, sessionPattern} from "./lib/campaign-orders.mjs";
import {campaignStore} from "./lib/campaign-store.mjs";
import {StripeRequestError, stripeApi} from "./lib/stripe-api.mjs";

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

async function readJson(request, limit = 12000) {
  const reader = request.body?.getReader();
  if (!reader) throw {error: "The request was empty.", status: 400};
  const buffer = new Uint8Array(limit);
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
      attentionPrice: env.CAMPAIGN_ATTENTION_PRICE_ID || "",
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

async function adminUser(request, env, url) {
  const owner = await passwordAdmin(request, env, url);
  if (owner) return {...owner, mode: "password"};
  const accessUser = await authenticatedAdmin(request, env);
  return accessUser ? {...accessUser, mode: "access"} : null;
}

async function adminSessionRoute(request, env, url) {
  if (request.method === "GET") {
    const user = await adminUser(request, env, url);
    return json({authenticated: Boolean(user), mode: user?.mode, passwordConfigured: passwordConfigured(env)});
  }
  if (!["POST", "DELETE"].includes(request.method)) return methodNotAllowed("GET, POST, DELETE");
  if (!sameOriginJson(request, url)) return apiError("Same-origin requests required.", 403);
  if (request.method === "DELETE") {
    return new Response(null, {status: 204, headers: {...apiHeaders, "Set-Cookie": clearPasswordSession(url)}});
  }
  try {
    const input = await readJson(request);
    const cookie = await signInWithPassword(request, env, url, input?.password);
    return Response.json({authenticated: true, mode: "password"},
      {headers: {...apiHeaders, "Set-Cookie": cookie}});
  } catch (error) {
    return routeFailure(error, "Could not sign in. Check the admin password and database setup.");
  }
}

async function stripeStatusRoute(request, env) {
  if (request.method !== "GET") return methodNotAllowed("GET");
  if (!env.STRIPE_SECRET_KEY) {
    return json({state: "missing", message: "Set the existing Stripe account’s STRIPE_SECRET_KEY in the Worker."});
  }
  const mode = /^(?:sk|rk)_(live|test)_/.exec(env.STRIPE_SECRET_KEY)?.[1];
  if (!mode) return json({state: "error", message: "The Worker needs a Stripe secret or restricted API key."});
  try {
    await stripeApi(env.STRIPE_SECRET_KEY).checkConnection();
    return json({state: "connected", mode,
      message: `Stripe Checkout API reachable in ${mode} mode${env.CAMPAIGN_DB ? "." : ". Add the CAMPAIGN_DB binding to accept orders."}`});
  } catch (error) {
    const failure = error instanceof StripeRequestError ? error : null;
    let message = "The Worker could not run the Stripe connection check. Check that the secret contains only the key.";
    if (failure?.status === 401) {
      message = "Stripe rejected the API key. Check that the full key is active and copied into the Production Worker secret.";
    } else if (failure?.status === 403) {
      message = "Stripe denied the Checkout Sessions request. Check the key’s Checkout Sessions permissions and access policy.";
    } else if (failure?.status && failure.status >= 400) {
      message = "Stripe returned an error while listing Checkout Sessions.";
    } else if (failure?.code === "worker_timeout") {
      message = "The Worker timed out waiting for Stripe.";
    } else if (failure?.code === "worker_connection") {
      message = "The Worker could not connect to Stripe. No HTTP response was received.";
    } else if (failure) {
      message = "Stripe returned an unexpected response to the Checkout Sessions check.";
    }
    if (failure?.status) message += ` HTTP ${failure.status}.`;
    if (failure?.requestId) message += ` Stripe request ID ${failure.requestId}.`;
    return json({state: "error", mode, message});
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
    const {sessionId, previous, action, stage} = await readJson(request) ?? {};
    if (action === "set-stage") {
      if (typeof sessionId !== "string" || !sessionPattern.test(sessionId) ||
          !["new", "production", "ready"].includes(stage)) return apiError("Invalid campaign stage.", 400);
      const updated = await store.updateStage(sessionId, stage);
      return updated ? json(updated) : apiError("This brief is missing or has already been delivered.", 409);
    }
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

async function portfolioRoute(request, env, url, admin) {
  const base = admin ? "/api/admin/portfolio" : "/api/portfolio";
  if (!["GET", "HEAD"].includes(request.method) && !(admin && request.method === "POST" && url.pathname === base)) {
    return methodNotAllowed(admin ? "GET, HEAD, POST" : "GET, HEAD");
  }
  if (!env.CAMPAIGN_DB) return apiError("Portfolio storage is unavailable.", 503);
  try {
    if (request.method === "POST") {
      if (!sameOriginJson(request, url)) return apiError("Same-origin requests required.", 403);
      return json(await savePortfolio(env.CAMPAIGN_DB, await readJson(request, 1_125_000)));
    }
    if (url.pathname !== base) {
      const match = /^\/([a-f0-9-]+)\/image$/.exec(url.pathname.slice(base.length));
      const image = match && await portfolioImage(env.CAMPAIGN_DB, match[1], admin);
      if (!image) return apiError("Campaign image not found.", 404);
      return new Response(request.method === "HEAD" ? null : image, {headers: {...apiHeaders, "Content-Type": "image/webp"}});
    }
    if (!admin && url.searchParams.has("id")) {
      const campaign = await portfolioItem(env.CAMPAIGN_DB, url.searchParams.get("id"));
      return campaign ? json(campaign) : apiError("Campaign not found.", 404);
    }
    const offset = Number(url.searchParams.get("offset") ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0) return apiError("Invalid campaign offset.", 400);
    return json(await portfolioList(env.CAMPAIGN_DB, offset, admin));
  } catch (error) {
    return routeFailure(error, "Could not load or save the campaign. Check the database migration and try again.");
  }
}

const socialMethods = new Map([
  ["config", ["GET"]], ["status", ["GET"]], ["connect", ["POST"]], ["publish", ["POST"]],
  ["history", ["GET", "POST"]], ["upload-ticket", ["POST"]]
]);

async function socialRoute(request, env, url, user) {
  const action = url.pathname.slice("/api/ad-studio/social/".length);
  const methods = socialMethods.get(action);
  if (!methods) return apiError("Unknown publishing action.", 404);
  if (!methods.includes(request.method)) return methodNotAllowed(methods.join(", "));
  if (request.method === "POST" && request.headers.get("Origin") !== url.origin) {
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
      "connect-src 'self' https://api.cloudinary.com",
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

    if (url.pathname === "/api/admin/session") return adminSessionRoute(request, env, url);

    const isAdmin = url.pathname === "/admin.html";
    const isEditor = url.pathname.startsWith("/admin-ad-studio/");
    const isAdminApi = url.pathname === "/api/admin/campaigns";
    const isPortfolio = url.pathname === "/api/portfolio" || url.pathname.startsWith("/api/portfolio/");
    if (isPortfolio) return portfolioRoute(request, env, url, false);
    const isAdminPortfolio = url.pathname === "/api/admin/portfolio" || url.pathname.startsWith("/api/admin/portfolio/");
    const isStripeStatus = url.pathname === "/api/admin/stripe";
    const isSocialApi = url.pathname.startsWith("/api/ad-studio/social/");
    if (isEditor || isAdminApi || isAdminPortfolio || isStripeStatus || isSocialApi) {
      const user = await adminUser(request, env, url);
      if (!user) {
        if (isEditor && (!url.pathname.split("/").at(-1) || url.pathname.endsWith(".html"))) {
          return Response.redirect(new URL("/admin.html#ad-studio-view", url.origin), 302);
        }
        return apiError("Administrator sign-in required.", 401);
      }
      if (isAdminPortfolio) return portfolioRoute(request, env, url, true);
      if (isAdminApi) return adminCampaignRoute(request, env, url);
      if (isStripeStatus) return stripeStatusRoute(request, env);
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
