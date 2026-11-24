import {readFile, readdir} from "node:fs/promises";
import {DatabaseSync} from "node:sqlite";
import worker from "../worker.mjs";

export const testPassword = "synthetic-campaign-admin-password-for-tests";
export const testBuyer = "campaign-buyer@example.test";
const fakeStripeKey = "sk_test_fixture";
const contentTypes = {
  html: "text/html", css: "text/css", js: "text/javascript", mjs: "text/javascript", woff2: "font/woff2", json: "application/json",
  png: "image/png", webp: "image/webp", svg: "image/svg+xml", txt: "text/plain"
};

function sqliteBinding(db) {
  return {
    async batch(queries) {
      db.exec("BEGIN");
      try {
        const results = queries.map((query) => query.all());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        bind(...values) {
          return {
            first() { return statement.get(...values) ?? null; },
            all() { return {results: statement.all(...values)}; },
            run() { return {meta: statement.run(...values)}; }
          };
        }
      };
    }
  };
}

async function asset(request) {
  const path = new URL(request.url).pathname.slice(1);
  const type = contentTypes[path.split(".").at(-1)] || "application/octet-stream";
  try {
    const body = await readFile(new URL("../public/" + path, import.meta.url));
    return new Response(request.method === "HEAD" ? null : body, {headers: {"Content-Type": type}});
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "EISDIR") throw error;
    return new Response(await readFile(new URL("../public/404.html", import.meta.url)), {
      status: 404,
      headers: {"Content-Type": "text/html"}
    });
  }
}

export async function createFixture() {
  const db = new DatabaseSync(":memory:");
  const migrations = await readdir(new URL("../migrations/campaign/", import.meta.url));
  for (const file of migrations.filter((name) => name.endsWith(".sql")).sort()) {
    db.exec(await readFile(new URL("../migrations/campaign/" + file, import.meta.url), "utf8"));
  }
  db.exec(await readFile(new URL("../migrations/ad-studio.sql", import.meta.url), "utf8"));
  const requests = [];
  const sessions = new Map();
  const checkoutKeys = new Map();
  const env = {
    ASSETS: {fetch: asset},
    CAMPAIGN_DB: sqliteBinding(db),
    AD_STUDIO_DB: sqliteBinding(db),
    ADMIN_PASSWORD: testPassword,
    STRIPE_SECRET_KEY: fakeStripeKey,
    CAMPAIGN_ATTENTION_ENABLED: "true",
    CAMPAIGN_LANDING_ENABLED: "true"
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    if (url.origin !== "https://api.stripe.com") throw new Error("Unexpected external API: " + url.origin);
    if (options.headers.get("Authorization") !== "Bearer " + fakeStripeKey) {
      return Response.json({error: {code: "invalid_api_key"}}, {status: 401});
    }
    requests.push({path: url.pathname, method: options.method, form: options.body});
    if (url.pathname === "/v1/checkout/sessions" && options.method === "GET") {
      return Response.json({object: "list", data: []});
    }
    if (url.pathname === "/v1/checkout/sessions" && options.method === "POST") {
      const idempotencyKey = options.headers.get("Idempotency-Key");
      const existing = checkoutKeys.get(idempotencyKey);
      if (existing) return Response.json(existing);
      const form = options.body;
      const metadata = {};
      for (const field of ["kind", "campaign_offer", "parent_session"]) {
        if (form.has(`metadata[${field}]`)) metadata[field] = form.get(`metadata[${field}]`);
      }
      const id = `cs_test_fixturecampaign${sessions.size + 1}`;
      const session = {
        id, metadata, mode: form.get("mode"),
        currency: form.get("line_items[0][price_data][currency]"),
        amount_total: Number(form.get("line_items[0][price_data][unit_amount]")),
        status: "open", payment_status: "unpaid",
        customer_details: {email: testBuyer},
        success_url: form.get("success_url"),
        url: "https://checkout.stripe.com/c/pay/" + id
      };
      sessions.set(id, session);
      checkoutKeys.set(idempotencyKey, session);
      return Response.json(session);
    }
    const session = sessions.get(url.pathname.split("/").at(-1));
    return session ? Response.json(session) : Response.json({error: {code: "resource_missing"}}, {status: 404});
  };

  return {
    env, requests,
    request: (request) => worker.fetch(request, env),
    completePayment(id) {
      const session = sessions.get(id);
      if (!session) return null;
      session.status = "complete";
      session.payment_status = "paid";
      return session.success_url.replace("{CHECKOUT_SESSION_ID}", id);
    },
    close() {
      globalThis.fetch = originalFetch;
      db.close();
    }
  };
}
