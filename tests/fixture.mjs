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
  const monthly = {objects:new Map(), mail:[], signatures:0, publicBucket:false, bucketLimit:20*1024*1024, rejectBucketUpdate:false, failMailOnce:false};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    if(url.origin==="https://fixtureproject.supabase.co"){
      const key=options.headers.get("apikey");
      if(!((key==="fixture-storage-key" && options.headers.get("Authorization")==="Bearer fixture-storage-key") ||
          (key==="sb_secret_fixture" && !options.headers.get("Authorization"))))return Response.json({}, {status:401});
      if(url.pathname==="/storage/v1/bucket/monthly-asset-packs"){
        if(options.method==="PUT"){
          if(monthly.rejectBucketUpdate)return Response.json({}, {status:400});
          const patch=JSON.parse(options.body);
          monthly.bucketLimit=patch.file_size_limit;
          return Response.json({message:"updated"});
        }
        return Response.json({public:monthly.publicBucket,file_size_limit:monthly.bucketLimit,allowed_mime_types:["application/zip"]});
      }
      if(url.pathname==="/storage/v1/object/list/monthly-asset-packs"){
        return Response.json([...monthly.objects].map(([name,data])=>({id:"fixture-"+name,name,metadata:{size:data.byteLength}})));
      }
      const path=url.pathname.split("/").at(-1);
      if(url.pathname.includes("/object/sign/")){
        if(!monthly.objects.has(path))return Response.json({}, {status:404});
        return Response.json({signedURL:"/object/sign/monthly-asset-packs/"+path+"?token=fixture"+(++monthly.signatures)});
      }
      if(url.pathname.includes("/object/authenticated/monthly-asset-packs/")){
        return monthly.objects.has(path)?new Response(monthly.objects.get(path),{headers:{"Content-Length":String(monthly.objects.get(path).byteLength)}}):Response.json({}, {status:404});
      }
      if(url.pathname.includes("/object/monthly-asset-packs/") && options.method==="POST"){
        if(options.body.byteLength>monthly.bucketLimit)return Response.json({message:"File too large"},{status:413});
        if(monthly.objects.has(path))return Response.json({}, {status:409});
        monthly.objects.set(path,new Uint8Array(options.body));return Response.json({Key:path});
      }
      return Response.json({}, {status:404});
    }
    if(url.origin==="https://api.resend.com"){
      const payload=JSON.parse(options.body);
      monthly.mail.push({key:options.headers["Idempotency-Key"],payload});
      if(monthly.failMailOnce){monthly.failMailOnce=false;return Response.json({}, {status:503});}
      return Response.json({id:"fixture-mail-"+monthly.mail.length});
    }
    if (url.origin !== "https://api.stripe.com") throw new Error("Unexpected external API: " + url.origin);
    if (options.headers.get("Authorization") !== "Bearer " + fakeStripeKey) {
      return Response.json({error: {code: "invalid_api_key"}}, {status: 401});
    }
    requests.push({path: url.pathname, method: options.method, form: options.body});
    if (url.pathname === "/v1/checkout/sessions" && options.method === "GET") {
      return Response.json({object: "list", data: []});
    }
    if (url.pathname === "/v1/prices/price_fixture_monthly" && options.method === "GET") {
      return Response.json({id: "price_fixture_monthly", active: true, currency: "usd", unit_amount: 4900,
        recurring: {interval: "month", interval_count: 1, usage_type: "licensed"}, billing_scheme: "per_unit"});
    }
    if (["/v1/prices/price_fixture_attention_legacy", "/v1/prices/price_fixture_attention_79"].includes(url.pathname) && options.method === "GET") {
      const id = url.pathname.split("/").at(-1);
      return Response.json({id, active: true, currency: "usd", unit_amount: id.endsWith("_79") ? 7900 : 19900,
        type: "one_time", billing_scheme: "per_unit"});
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
      const fixedPrices = {price_fixture_monthly: 4900, price_fixture_attention_79: 7900, price_fixture_attention_legacy: 19900};
      const fixedAmount = fixedPrices[form.get("line_items[0][price]")];
      const session = {
        id, metadata, mode: form.get("mode"),
        currency: form.get("line_items[0][price_data][currency]") || (fixedAmount === undefined ? null : "usd"),
        amount_total: fixedAmount ?? Number(form.get("line_items[0][price_data][unit_amount]")),
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
    env, requests, monthly,
    request: (request) => worker.fetch(request, env),
    completePayment(id, fixtureAmount) {
      const session = sessions.get(id);
      if (!session) return null;
      if (fixtureAmount !== undefined) session.amount_total = fixtureAmount;
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
