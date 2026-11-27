import {test} from "node:test";
import assert from "node:assert/strict";
import {createFixture, testBuyer, testPassword} from "./fixture.mjs";

const origin = "https://studio.example.test";
const adminApi = "/api/admin/campaigns";

async function setup(t) {
  const fixture = await createFixture();
  t.after(() => fixture.close());
  return {...fixture, call(path, {body, method, headers = {}, requestOrigin = origin} = {}) {
    return fixture.request(new Request(origin + path, {
      method: method || (body === undefined ? "GET" : "POST"),
      headers: body === undefined ? headers : {
        Origin: requestOrigin, "Content-Type": "application/json", ...headers
      },
      ...(body === undefined ? {} : {body: JSON.stringify(body)})
    }));
  }};
}

async function login(site, password = testPassword) {
  return site.call("/api/admin/session", {
    body: {password}, headers: {"CF-Connecting-IP": "192.0.2.1"}
  });
}

test("legacy gallery artwork URLs serve the same protected files as the new URLs", async (t) => {
  const site = await setup(t);
  for (const filename of ["orbit-roast", "orbit-roast-640", "boom-bun", "mossbyte", "static-bloom", "midnight-sole"]) {
    const legacy = await site.call(`/assets/campaigns/${filename}.webp`, {
      headers: {"If-None-Match": '"unmarked-cached-image"'}
    });
    const preview = await site.call(`/assets/campaign-examples/${filename}.webp`);
    assert.equal(legacy.status, 200);
    assert.equal(legacy.headers.get("Cache-Control"), "no-store");
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get("Content-Type"), "image/webp");
    assert.deepEqual(await legacy.arrayBuffer(), await preview.arrayBuffer());
  }
});

test("legacy service artwork URLs serve only the new protected previews", async (t) => {
  const site = await setup(t);
  for (const filename of ["solar-dunes", "emerald-mist", "arcade-wave", "alpine-dawn",
    "velvet-rose", "neon-underpass", "paper-architecture", "celestial-drift", "citrus-splash", "ink-and-sun", "ember-orbit"]) {
    const legacy = await site.call(`/assets/service-examples/${filename}.webp`);
    const preview = await site.call(`/assets/service-previews/${filename}.webp`);
    assert.equal(legacy.status, 200);
    assert.equal(legacy.headers.get("Cache-Control"), "no-store");
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get("Content-Type"), "image/webp");
    assert.deepEqual(await legacy.arrayBuffer(), await preview.arrayBuffer());
  }
  assert.equal((await site.call("/assets/service-examples/unknown.webp")).status, 404);
});

test("the footer opens admin sign-in and protected routes require a valid session", async (t) => {
  const site = await setup(t);
  const home = await site.call("/");
  assert.equal(home.status, 200);
  assert.match(await home.text(), /<footer[^>]*>.*href="\/admin.html".*pixel-shroom-logo/);
  const admin = await site.call("/admin.html");
  assert.equal(admin.status, 200);
  assert.match(await admin.text(), /Administrator sign-in/);
  assert.equal(admin.headers.get("Cache-Control"), "no-store");
  assert.equal((await site.call(adminApi)).status, 401);
  assert.equal((await site.call("/api/admin/stripe")).status, 401);
  assert.equal((await site.call("/admin-ad-studio/")).status, 302);
  assert.equal((await site.call("/%61dmin.html")).status, 404);
  assert.equal((await login(site, "wrong")).status, 401);

  const signed = await login(site);
  assert.equal(signed.status, 200);
  const cookie = signed.headers.get("Set-Cookie");
  assert.match(cookie, /^__Host-pss_admin=.*HttpOnly; SameSite=Strict; Secure$/);
  const headers = {Cookie: cookie.split(";")[0]};
  assert.equal((await site.call(adminApi, {headers})).status, 200);
  assert.equal((await site.call("/admin-ad-studio/", {headers})).status, 200);
  assert.equal((await site.call(adminApi, {headers: {Cookie: headers.Cookie + "x"}})).status, 401);
  const stripe = await site.call("/api/admin/stripe", {headers});
  assert.equal((await stripe.json()).mode, "test");
  const signedOut = await site.call("/api/admin/session", {method: "DELETE", body: {}, headers});
  assert.equal(signedOut.status, 204);
  assert.match(signedOut.headers.get("Set-Cookie"), /Max-Age=0/);
});

test("password attempts are rate limited and other origins cannot sign in", async (t) => {
  const site = await setup(t);
  const crossed = await site.call("/api/admin/session", {
    body: {password: testPassword}, requestOrigin: "https://elsewhere.example.test"
  });
  assert.equal(crossed.status, 403);
  for (let i = 0; i < 10; i += 1) assert.equal((await login(site, "wrong")).status, 401);
  assert.equal((await login(site)).status, 429);
});

test("Stripe creates a $79 session and only a paid session can save a brief", async (t) => {
  const site = await setup(t);
  const campaign = (body) => site.call("/api/campaign-orders", {body});
  const offers = await (await campaign({action: "offers"})).json();
  assert.equal(offers.attention, true);
  assert.equal(offers.landing, true);
  assert.equal(offers.monthly, false);

  const checkout = {action: "checkout", offer: "attention", requestId: crypto.randomUUID()};
  const first = await campaign(checkout);
  assert.equal(first.status, 200);
  const {url} = await first.json();
  assert.equal((await (await campaign(checkout)).json()).url, url);
  assert.match(url, /^https:\/\/checkout\.stripe\.com\//);
  const form = site.requests.find((request) => request.method === "POST").form;
  assert.equal(form.get("line_items[0][price_data][unit_amount]"), "7900");
  assert.equal(form.get("success_url"), origin + "/brief.html?session_id={CHECKOUT_SESSION_ID}");

  const sessionId = url.split("/").at(-1);
  const brief = {
    action: "brief", sessionId,
    brief: {business: "Fixture Roaster", industry: "Coffee", vibe: "Bold crisp nocturnal", goal: "Winter launch"}
  };
  assert.equal((await campaign(brief)).status, 409);
  assert.match(site.completePayment(sessionId), /brief\.html\?session_id=cs_test_/);
  assert.equal((await campaign(brief)).status, 200);
  assert.equal((await campaign(brief)).status, 200);
  assert.equal((await campaign({action: "download", sessionId})).status, 410);

  const credentials = await login(site);
  const headers = {Cookie: credentials.headers.get("Set-Cookie").split(";")[0]};
  const {orders} = await (await site.call(adminApi, {headers})).json();
  assert.equal(orders.length, 1);
  assert.equal(orders[0].buyer_email, testBuyer);
  const delivery = {sessionId, previous: null};
  const sent = await (await site.call(adminApi, {body: delivery, headers})).json();
  assert.ok(Date.parse(sent.email_delivered_at));
  const retry = await (await site.call(adminApi, {body: delivery, headers})).json();
  assert.deepEqual(retry, sent);
});

test("Attention Pack creates new $79 checkouts with legacy or new Stripe Price settings and honors old paid orders", async (t) => {
  const site = await setup(t);
  const campaign = (body) => site.call("/api/campaign-orders", {body});
  const checkout = () => campaign({action: "checkout", offer: "attention", requestId: crypto.randomUUID()});
  site.env.CAMPAIGN_ATTENTION_PRICE_ID = "price_fixture_attention_legacy";
  const stale = await checkout();
  assert.equal(stale.status, 200);
  const oldSessionId = (await stale.json()).url.split("/").at(-1);
  const staleForm = site.requests.filter(r => r.method === "POST").at(-1).form;
  assert.equal(staleForm.get("line_items[0][price]"), null);
  assert.equal(staleForm.get("line_items[0][price_data][unit_amount]"), "7900");
  // Simulate a session issued before the price change.
  site.completePayment(oldSessionId, 19900);
  const brief = {business: "Legacy Order", industry: "Art", vibe: "Bright bold wild", goal: "Launch"};
  assert.equal((await campaign({action: "brief", sessionId: oldSessionId, brief})).status, 200);
  site.env.CAMPAIGN_ATTENTION_PRICE_ID = "price_fixture_attention_79";
  const current = await checkout();
  assert.equal(current.status, 200);
  const sessionId = (await current.json()).url.split("/").at(-1);
  assert.equal(site.requests.filter(r => r.method === "POST").at(-1).form.get("line_items[0][price]"), "price_fixture_attention_79");
  site.completePayment(sessionId);
  assert.equal((await campaign({action: "brief", sessionId, brief})).status, 200);
  site.completePayment(sessionId, 7800);
  assert.equal((await campaign({action: "order", sessionId})).status, 404);
});

test("configured monthly subscription and $199 landing add-on use the correct checkout", async (t) => {
  const site = await setup(t);
  const campaign = (body) => site.call("/api/campaign-orders", {body});
  site.env.CAMPAIGN_MONTHLY_PRICE_ID = "price_fixture_monthly";
  site.env.CAMPAIGN_BILLING_PORTAL_URL = "https://billing.stripe.com/p/login/fixture";
  const offers = await (await campaign({action: "offers"})).json();
  assert.equal(offers.monthly, true);
  assert.equal(offers.landing, true);
  const monthly = await campaign({action: "checkout", offer: "monthly", requestId: crypto.randomUUID()});
  assert.equal(monthly.status, 200);
  const monthlyURL = (await monthly.json()).url;
  const monthlyForm = site.requests.find(r => r.method === "POST").form;
  assert.equal(monthlyForm.get("mode"), "subscription");
  assert.equal(monthlyForm.get("line_items[0][price]"), "price_fixture_monthly");
  const monthlyId = monthlyURL.split("/").at(-1);
  assert.equal((await campaign({action: "order", sessionId: monthlyId})).status, 409);
  site.completePayment(monthlyId);
  const confirmed = {offer: "monthly", submitted: true, canAddLanding: false};
  assert.deepEqual((await (await campaign({action: "order", sessionId: monthlyId})).json()), confirmed);
  assert.deepEqual((await (await campaign({action: "order", sessionId: monthlyId})).json()), confirmed);
  // Older cached clients may submit a brief; the monthly order needs no brief fields.
  assert.deepEqual((await (await campaign({action: "brief", sessionId: monthlyId})).json()), confirmed);
  const credentials = await login(site);
  const headers = {Cookie: credentials.headers.get("Set-Cookie").split(";")[0]};
  const {orders: monthlyOrders} = await (await site.call(adminApi, {headers})).json();
  assert.equal(monthlyOrders.length, 1);
  assert.equal(monthlyOrders[0].buyer_email, testBuyer);
  assert.equal(monthlyOrders[0].business, "Monthly Asset Pack");
  assert.equal(monthlyOrders[0].industry, "");
  assert.equal(monthlyOrders[0].vibe, "");
  assert.match(monthlyOrders[0].goal, /randomly themed/);
  const attention = await campaign({action: "checkout", offer: "attention", requestId: crypto.randomUUID()});
  const parentSession = (await attention.json()).url.split("/").at(-1);
  const landing = {action: "checkout", offer: "landing", parentSession, requestId: crypto.randomUUID()};
  assert.equal((await campaign(landing)).status, 409);
  site.completePayment(parentSession);
  assert.equal((await campaign(landing)).status, 409);
  const brief = {business: "Landing fixture", industry: "Coffee", vibe: "Bright bold wild", goal: "Demo"};
  const order = await (await campaign({action: "brief", sessionId: parentSession, brief})).json();
  assert.equal(order.canAddLanding, true);
  const addOn = await campaign(landing);
  assert.equal(addOn.status, 200);
  const landingId = (await addOn.json()).url.split("/").at(-1);
  assert.equal(site.requests.filter(r => r.method === "POST").at(-1).form.get("line_items[0][price_data][unit_amount]"), "19900");
  site.completePayment(landingId);
  assert.equal((await (await campaign({action: "order", sessionId: landingId})).json()).offer, "landing");
  assert.equal((await (await campaign({action: "order", sessionId: parentSession})).json()).canAddLanding, false);
});

test("portfolio drafts stay private and published campaigns can be edited or withdrawn", async (t) => {
  const site = await setup(t);
  const admin = "/api/admin/portfolio";
  const published = "/api/portfolio";
  const cleanAsset = "/admin-ad-studio/assets/campaign-art/orbit-roast.webp";
  const id = crypto.randomUUID();
  const signed = await login(site);
  const headers = {Cookie: signed.headers.get("Set-Cookie").split(";")[0]};
  const preview = Buffer.from(await (await site.call("/assets/campaigns/orbit-roast-640.webp")).arrayBuffer()).toString("base64");
  assert.equal((await site.call(cleanAsset)).status, 401);
  const image = Buffer.from(await (await site.call(cleanAsset, {headers})).arrayBuffer()).toString("base64");
  const body = {id, version: 0, published: false, image, preview,
    name: 'Roast & "Co"', sector: "food", tagline: 'A new roast <with> "character"', brief: "Introduce a roast",
    value: "The image makes the product recognizable", alt: "A giant coffee bean", palette: "#D9FF55"};
  assert.equal((await site.call(admin, {body})).status, 401);
  assert.equal((await site.call(admin, {headers, body: {...body, preview: image}})).status, 400);

  const original = await site.call(admin, {body, headers});
  assert.equal(original.status, 200);
  assert.equal((await original.json()).version, 1);
  assert.equal((await site.call(`${published}?id=${id}`)).status, 404);
  assert.equal((await site.call(`${published}/${id}/image`)).status, 404);
  const sharePath = `/campaigns/${id}`;
  assert.equal((await site.call(sharePath)).status, 404);
  assert.equal((await site.call(`${sharePath}/artwork.webp`)).status, 404);
  assert.equal((await site.call(`${admin}/${id}/image`, {headers})).status, 200);

  const release = {...body, version: 1, image: null, preview: null, published: true};
  const live = await site.call(admin, {body: release, headers});
  assert.equal(live.status, 200);
  assert.equal((await live.json()).version, 2);
  const publicData = await (await site.call(published)).json();
  assert.equal(publicData.campaigns[0].id, id);
  assert.equal(publicData.campaigns[0].sharePath, sharePath);
  assert.equal(publicData.campaigns[0].image_webp, undefined);
  const shared = await site.call(`${sharePath}?utm_source=sample`);
  assert.equal(shared.status, 200);
  const html = await shared.text();
  assert.ok(html.includes('<meta property="og:title" content="Roast &amp; &quot;Co&quot; | Pixel Shroom Studio">'));
  assert.ok(html.includes('<meta property="og:description" content="A new roast &lt;with&gt; &quot;character&quot;">'));
  assert.ok(html.includes(`<meta property="og:url" content="${origin}${sharePath}">`));
  assert.ok(html.includes(`<meta property="og:image" content="${origin}${sharePath}/artwork.webp?v=2">`));
  assert.ok(html.includes(`<meta name="twitter:image" content="${origin}${sharePath}/artwork.webp?v=2">`));
  const legacy = await site.call(`/?campaign=${id}&utm_source=sample`);
  assert.equal(legacy.status, 302);
  assert.equal(legacy.headers.get("Location"), `${sharePath}?utm_source=sample`);
  const shareArt = await site.call(`${sharePath}/artwork.webp?v=2`);
  assert.equal(shareArt.headers.get("Content-Type"), "image/webp");
  assert.equal(Buffer.from(await shareArt.arrayBuffer()).toString("base64"), preview);
  const head = await site.call(`${sharePath}/artwork.webp?v=2`, {method: "HEAD"});
  assert.equal(Number(head.headers.get("Content-Length")), Buffer.from(preview, "base64").length);
  assert.equal(await head.text(), "");
  const publicImage = await site.call(`${published}/${id}/image`);
  assert.equal(publicImage.headers.get("Content-Type"), "image/webp");
  assert.equal(Buffer.from(await publicImage.arrayBuffer()).toString("base64"), preview);
  const privateImage = await site.call(`${admin}/${id}/image`, {headers});
  assert.equal(Buffer.from(await privateImage.arrayBuffer()).toString("base64"), image);
  assert.equal((await site.call(`${admin}/${id}/image`)).status, 401);
  assert.equal((await site.call(admin, {body: release, headers})).status, 409);
  assert.equal((await site.call(admin, {body: {...release, version: 2, published: false}, headers})).status, 200);
  assert.equal((await site.call(`${published}?id=${id}`)).status, 404);
  assert.equal((await site.call(sharePath)).status, 404);
  assert.equal((await site.call(`${sharePath}/artwork.webp?v=2`)).status, 404);
});

test("previously published art stays private until a protected preview is generated", async t => {
  const site = await setup(t);
  const response = await login(site);
  const headers = {Cookie: response.headers.get("Set-Cookie").split(";")[0]};
  const id = crypto.randomUUID();
  const cleanPath = "/admin-ad-studio/assets/campaign-art/orbit-roast.webp";
  const file = async (path, auth = {}) => Buffer.from(await (await site.call(path, auth)).arrayBuffer()).toString("base64");
  const image = await file(cleanPath, {headers});
  const preview = await file("/assets/campaigns/orbit-roast-640.webp");
  await site.env.CAMPAIGN_DB.prepare(`INSERT INTO portfolio_campaigns
    (id, name, sector, tagline, brief, creative_value, image_alt, palette, image_webp, published, updated_at)
    VALUES (?, 'Legacy campaign', 'food', 'Tagline', 'Brief', 'Value', 'Image', '', ?, 1, '2026-11-23')`)
    .bind(id, image).run();
  const admin = "/api/admin/portfolio";
  const publicUrl = "/api/portfolio";
  assert.equal((await site.call(publicUrl + "/" + id + "/image")).status, 404);
  assert.equal((await (await site.call(publicUrl)).json()).campaigns.length, 0);
  const [item] = (await (await site.call(admin, {headers})).json()).campaigns;
  assert.equal(item.previewReady, false);
  const body = {action: "protect-preview", id, version: item.version, preview};
  assert.equal((await site.call(admin, {body})).status, 401);
  assert.equal((await site.call(admin, {body, headers})).status, 200);
  assert.equal((await site.call(admin, {body, headers})).status, 409);
  assert.equal(await file(publicUrl + "/" + id + "/image"), preview);
  assert.equal(await file(admin + "/" + id + "/image", {headers}), image);
});

test("AD publishing requires admin authentication and same-origin writes", async t => {
  const site = await setup(t);
  const base = "/api/ad-studio/social/";
  for (const path of ["config", "history", "status"]) assert.equal((await site.call(base + path)).status, 401);
  const loginResponse = await login(site);
  const headers = {Cookie: loginResponse.headers.get("Set-Cookie").split(";")[0]};
  for (const path of ["connect", "publish", "history", "upload-ticket"]) {
    const response = await site.call(base + path, {headers, body: {}, requestOrigin: "https://elsewhere.example.test"});
    assert.equal(response.status, 403);
  }
  assert.equal((await site.call(base + "upload-ticket", {headers})).status, 405);
  assert.deepEqual(await (await site.call(base + "history", {headers})).json(), {submissions: []});
});

test("Buffer reconnect recovers missing publishing tables, uses the proper token, and preserves history", async t => {
  const site = await setup(t);
  const auth = await login(site);
  const headers = {Cookie: auth.headers.get("Set-Cookie").split(";")[0]};
  const base = "/api/ad-studio/social/";
  delete site.env.AD_STUDIO_DB;
  await site.env.CAMPAIGN_DB.prepare("DROP TABLE publishing_credentials").bind().run();
  await site.env.CAMPAIGN_DB.prepare("DROP TABLE publishing_submissions").bind().run();
  const received = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.buffer.com");
    received.push(options.headers.Authorization);
    const {query} = JSON.parse(options.body);
    if (query.includes("organizations")) return Response.json({data: {account: {organizations: [{id:"org",name:"Mock"}]}}});
    if (query.includes("channels(")) return Response.json({data: {channels: [{id:"fb",service:"facebook",displayName:"Studio"}]}});
    throw Error("No social post should be sent during reconnect");
  };
  const config = async () => (await (await site.call(base + "config", {headers})).json());
  const connect = token => site.call(base + "connect", {headers, body:{bufferKey:token}});
  site.env.BUFFER_CREDENTIAL_ENCRYPTION_KEY = "not-an-encryption-key";
  let info = await config();
  assert.equal(info.configured, false);
  assert.equal(info.secureStorage, false);
  assert.equal((await connect("fixture-buffer-key")).status, 503);
  assert.deepEqual(received, []);
  site.env.BUFFER_API_KEY = "fixture-worker-buffer-key";
  info = await config();
  assert.equal(info.configured, true);
  assert.equal(info.bufferSource, "worker");
  assert.equal(info.platforms[0].accountId, "fb");
  assert.equal((await connect("fixture-other-buffer-key")).status, 409);
  assert.ok(received.every(v => v === "Bearer fixture-worker-buffer-key"));
  assert.doesNotMatch(JSON.stringify(info), /fixture-worker-buffer-key/);

  delete site.env.BUFFER_API_KEY;
  site.env.BUFFER_CREDENTIAL_ENCRYPTION_KEY = "ab".repeat(32);
  assert.equal((await connect("fixture-saved-buffer-key")).status, 200);
  info = await config();
  assert.equal(info.bufferSource, "saved");
  assert.equal(info.configured, true);
  const row = await site.env.CAMPAIGN_DB.prepare("SELECT encrypted FROM publishing_credentials LIMIT 1").bind().first();
  assert.doesNotMatch(row.encrypted, /fixture-saved-buffer-key/);
  site.env.BUFFER_CREDENTIAL_ENCRYPTION_KEY = "cd".repeat(32);
  info = await config();
  assert.equal(info.configured, false);
  assert.equal(info.bufferNeedsUpdate, true);
  assert.match(info.accountsError, /could not be unlocked/);
  assert.equal((await connect("fixture-new-buffer-key")).status, 200);
  info = await config();
  assert.equal(info.configured, true);
  assert.equal(info.bufferSource, "saved");
  assert.equal(info.platforms[0].accountId, "fb");
  assert.deepEqual(await (await site.call(base + "history", {headers})).json(), {submissions: []});
  assert.ok(received.every(v => !v.includes("ab".repeat(32)) && !v.includes("cd".repeat(32))));
});

test("AD publishing signs uploads and records account history with caption overrides", async t => {
  const site = await setup(t);
  const auth = await login(site);
  const cookie = auth.headers.get("Set-Cookie").split(";")[0];
  const base = origin + "/api/ad-studio/social/";
  site.env.BUFFER_CREDENTIAL_ENCRYPTION_KEY = "f0".repeat(32);
  site.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
  site.env.CLOUDINARY_API_KEY = "1234";
  site.env.CLOUDINARY_API_SECRET = "synthetic-signing-secret";
  let sent;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.buffer.com");
    const {query, variables} = JSON.parse(options.body);
    if (query.includes("organizations")) return Response.json({data: {account: {organizations: [{id: "org", name: "Mock"}]}}});
    if (query.includes("channels(")) return Response.json({data: {channels: [{id: "bsky", service: "bluesky"}]}});
    assert.match(query, /createPost/);
    sent = variables.input;
    return Response.json({data: {createPost: {post: {id: "buffer-post", status: "sent"}}}});
  };
  const post = (path, body, headers = {}) => site.request(new Request(base + path, {
    method: "POST", headers: {Origin: origin, Cookie: cookie, ...headers}, body
  }));
  const get = path => site.request(new Request(base + path, {headers: {Cookie: cookie}}));
  assert.equal((await post("connect", JSON.stringify({bufferKey: "buffer-fixture-key"}), {"Content-Type": "application/json"})).status, 200);
  const ticket = await (await post("upload-ticket")).json();
  assert.equal(ticket.endpoint, "https://api.cloudinary.com/v1_1/test-cloud/video/upload");
  assert.match(ticket.fields.public_id, /^pss-ad-/);
  assert.equal(ticket.fields.overwrite, "false");
  assert.equal(ticket.fields.api_key, "1234");
  const payload = `overwrite=false&public_id=${ticket.fields.public_id}&timestamp=${ticket.fields.timestamp}synthetic-signing-secret`;
  const expected = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload))).toString("hex");
  assert.equal(ticket.fields.signature, expected);
  assert.doesNotMatch(JSON.stringify(ticket), /synthetic-signing-secret/);

  const id = crypto.randomUUID();
  const form = new FormData();
  form.set("targets", JSON.stringify([{accountId: "bsky", platform: "bluesky"}]));
  form.set("title", "Round 2");
  form.set("caption", "Shared text");
  form.set("mediaUrl", "https://media.example.test/ad.mp4");
  form.set("captions", JSON.stringify({bluesky: "a".repeat(301)}));
  const headers = {"Idempotency-Key": id};
  assert.equal((await post("publish", form, headers)).status, 400);
  assert.equal(sent, undefined);
  form.set("captions", JSON.stringify({bluesky: "Channel-specific text"}));
  assert.equal((await post("publish", form, headers)).status, 202);
  assert.equal(sent.text, "Channel-specific text");
  const {submissions} = await (await get("history")).json();
  assert.equal(submissions[0].id, id);
  assert.equal(submissions[0].title, "Round 2");
  assert.equal((await post("history?id=" + id)).status, 200);
  assert.deepEqual(await (await get("history")).json(), {submissions: []});
  assert.equal((await post("publish", form, headers)).status, 200);
  assert.deepEqual(await (await get("history")).json(), {submissions: []});
});

import {deliverMonthlyQueue, validateMonthlyZip} from "../lib/monthly-delivery.mjs";

import {sampleZip} from "./monthly-zip-fixture.mjs";

async function signedInvoice(site,{id="in_first",type="invoice.paid",live=true,price="price_fixture_monthly",reason="subscription_create",paid=4900,status="paid",period=Math.floor(Date.now()/1000),badSignature=false}={}){
  const timestamp=Math.floor(Date.now()/1000);
  const event={type,livemode:live,data:{object:{object:"invoice",id,livemode:live,status,billing_reason:reason,
    currency:"usd",amount_paid:paid,customer_email:testBuyer,parent:{subscription_details:{subscription:"sub_fixture"}},lines:{data:[{pricing:{price_details:{price}},amount:4900,quantity:1,period:{start:period},parent:{subscription_item_details:{proration:false}}}]}}}};
  const raw=JSON.stringify(event), encoder=new TextEncoder();
  const key=await crypto.subtle.importKey("raw",encoder.encode(site.env.STRIPE_MONTHLY_WEBHOOK_SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const signature=Buffer.from(await crypto.subtle.sign("HMAC",key,encoder.encode(timestamp+"."+raw))).toString("hex");
  return site.request(new Request(origin+"/api/stripe/monthly-webhook",{method:"POST",headers:{"Stripe-Signature":"t="+timestamp+",v1="+(badSignature?"0".repeat(64):signature),"Content-Type":"application/json"},body:raw}));
}

test("paid monthly invoice queues privately; only ten-image ZIPs are published and emails retry without duplicates", async t=>{
  const site=await setup(t), now=Math.floor(Date.now()/1000), month=new Date(now*1000).toISOString().slice(0,7);
  Object.assign(site.env,{SUPABASE_URL:"https://fixtureproject.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"fixture-storage-key",
    STRIPE_MONTHLY_WEBHOOK_SECRET:"fixture-signing-secret",CAMPAIGN_MONTHLY_PRICE_ID:"price_fixture_monthly",
    CAMPAIGN_BILLING_PORTAL_URL:"https://billing.stripe.com/p/login/fixture",RESEND_API_KEY:"fixture-email-key",RESEND_FROM_EMAIL:"studio@example.test"});
  const path="/api/admin/monthly-delivery";
  assert.equal((await site.call(path)).status,401);
  assert.equal((await signedInvoice(site,{badSignature:true})).status,400);
  for(const ignored of [{live:false},{type:"invoice.payment_failed"},{price:"price_unrelated"},{paid:0},{status:"open"},{reason:"subscription_update"}])
    assert.equal((await (await signedInvoice(site,ignored)).json()).ignored,true);
  assert.equal((await (await signedInvoice(site)).json()).queued,true);
  assert.equal((await (await signedInvoice(site)).json()).queued,false);
  assert.equal((await deliverMonthlyQueue(site.env,now)).sent,0);
  site.env.MONTHLY_DELIVERY_ENABLED="true";
  await deliverMonthlyQueue(site.env,now);
  const credentials=await login(site), cookie=credentials.headers.get("Set-Cookie").split(";")[0];
  const status=async()=>await (await site.call(path,{headers:{Cookie:cookie}})).json();
  assert.equal((await status()).deliveries[0].state,"waiting");
  assert.equal(site.monthly.mail.length,0);
  const upload=(bytes,requestOrigin=origin)=>site.request(new Request(origin+path,{method:"POST",
    headers:{Cookie:cookie,Origin:requestOrigin,"Content-Type":"application/zip","X-Pack-Month":month},body:bytes}));
  assert.throws(()=>validateMonthlyZip(sampleZip(9)));
  assert.equal((await upload(sampleZip(9))).status,400);
  assert.equal((await upload(sampleZip(),"https://not-the-studio.example")).status,403);
  site.monthly.publicBucket=true;
  assert.equal((await upload(sampleZip())).status,503);
  site.monthly.publicBucket=false;
  assert.equal((await upload(sampleZip())).status,200);
  assert.equal((await upload(sampleZip())).status,409);
  site.monthly.failMailOnce=true;
  await deliverMonthlyQueue(site.env,now+10);
  assert.equal((await status()).deliveries[0].state,"pending");
  assert.equal(site.monthly.mail.length,1);
  assert.equal((await deliverMonthlyQueue(site.env,now+320)).sent,1);
  assert.equal(site.monthly.mail.length,2);
  assert.equal(site.monthly.mail[0].key,site.monthly.mail[1].key);
  assert.deepEqual(site.monthly.mail[0].payload,site.monthly.mail[1].payload);
  assert.equal(site.monthly.mail[1].payload.to[0],testBuyer);
  assert.equal(site.monthly.mail[1].payload.attachments[0].filename,"Pixel-Shroom-Monthly-Asset-Pack-"+month+".zip");
  assert.equal(site.monthly.signatures,1);
  assert.equal((await status()).deliveries[0].state,"sent");
  assert.equal((await deliverMonthlyQueue(site.env,now+640)).sent,0);
  assert.equal((await (await signedInvoice(site,{id:"in_renewal",reason:"subscription_cycle"})).json()).queued,true);
  assert.equal((await deliverMonthlyQueue(site.env,now+650)).sent,1);
  assert.equal((await status()).deliveries.length,2);
  assert.equal((await status()).deliveries.every(d=>d.state==="sent"),true);
  assert.equal(site.monthly.mail.length,3);
  assert.equal(JSON.stringify(await status()).includes("token=fixture"),false);
});

test("Windows ZIP folders, 25 MiB limit, connection diagnostics, and orphan recovery", async t=>{
  const site=await setup(t);
  Object.assign(site.env,{SUPABASE_URL:"https://fixtureproject.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"sb_secret_fixture"});
  const credentials=await login(site),cookie=credentials.headers.get("Set-Cookie").split(";")[0];
  const path="/api/admin/monthly-delivery";
  const status=async()=>await (await site.call(path,{headers:{Cookie:cookie}})).json();
  assert.equal((await status()).storageCheck.ok,true);
  assert.match((await status()).storageCheck.message,/raised to 25 MiB/);
  const upload=(month,bytes,existing=false)=>site.request(new Request(origin+path,{method:"POST",
    headers:{Cookie:cookie,Origin:origin,"Content-Type":existing?"application/json":"application/zip","X-Pack-Month":month,...(existing?{"X-Register-Existing":"true"}:{})},body:bytes}));
  const windowsZip=sampleZip(10,{folder:true});
  assert.equal(validateMonthlyZip(windowsZip),10);
  site.monthly.rejectBucketUpdate=true;
  assert.match((await (await upload("2026-11",windowsZip)).json()).error,/project upload limits/);
  site.monthly.rejectBucketUpdate=false;
  const large=sampleZip(10,{folder:true,size:2400000});
  assert.ok(large.length>20*1024*1024 && large.length<25*1024*1024);
  assert.equal((await upload("2026-11",large)).status,200);
  assert.equal(site.monthly.bucketLimit,25*1024*1024);
  assert.equal((await status()).packs[0].byte_size,large.length);
  assert.equal((await upload("2026-12",Buffer.alloc(25*1024*1024+1))).status,413);
  site.monthly.objects.set("2026-12.zip",windowsZip);
  site.monthly.objects.set("Other ZIP.zip",windowsZip);
  const inventory=(await status()).inventory;
  assert.equal(inventory.ok,true);
  assert.equal(inventory.files.find(x=>x.name==="2026-12.zip").status,"unregistered");
  assert.equal(inventory.files.find(x=>x.name==="2026-11.zip").status,"published");
  assert.equal(inventory.files.find(x=>x.name==="Other ZIP.zip").status,"other");
  const mismatched=sampleZip();
  assert.equal((await upload("2026-12",mismatched)).status,409);
  assert.equal((await upload("2026-12",windowsZip)).status,200);
  site.monthly.objects.set("2027-01.zip",windowsZip);
  assert.equal((await upload("2027-01","{}",true)).status,200);
  assert.equal((await status()).packs.length,3);
  assert.equal((await status()).inventory.files.find(x=>x.name==="2026-12.zip").status,"published");
  site.monthly.objects.delete("2026-11.zip");
  assert.ok((await status()).inventory.missing.includes("2026-11.zip"));
  assert.equal((await upload("2027-01","{}",true)).status,409);
  assert.equal((await upload("2027-02","{}",true)).status,409);
  site.monthly.publicBucket=true;
  assert.equal((await status()).storageCheck.ok,false);
});

test("monthly admin recovers missing monthly D1 tables and still reports Storage independently", async t=>{
  const site=await setup(t);
  Object.assign(site.env,{SUPABASE_URL:"https://fixtureproject.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"sb_secret_fixture"});
  const credentials=await login(site), cookie=credentials.headers.get("Set-Cookie").split(";")[0];
  const path="/api/admin/monthly-delivery";
  const status=async()=>await (await site.call(path,{headers:{Cookie:cookie}})).json();
  await site.env.CAMPAIGN_DB.prepare("DROP TABLE monthly_asset_deliveries").bind().run();
  await site.env.CAMPAIGN_DB.prepare("DROP TABLE monthly_asset_packs").bind().run();
  const recovered=await status();
  assert.equal(recovered.databaseCheck.ok,true);
  assert.equal(recovered.storageCheck.ok,true);
  assert.equal(recovered.inventory.ok,true);
  assert.deepEqual(recovered.packs,[]);
  const original=site.env.CAMPAIGN_DB;
  // Simulate an error only on monthly queries, keeping admin authentication working.
  site.env.CAMPAIGN_DB={...original,prepare(statement){
    if(statement.includes("monthly_asset_"))throw new Error("D1 unavailable");
    return original.prepare(statement);
  }};
  site.monthly.objects.set("2026-12.zip",sampleZip());
  const partial=await status();
  assert.equal(partial.databaseCheck.ok,false);
  assert.equal(partial.storageCheck.ok,true);
  assert.equal(partial.inventory.ok,true);
  assert.equal(partial.inventory.files[0].status,"unknown");
});

test("Facebook and LinkedIn regular feed posts accept text-only or image assets without the video path", async t => {
  const site = await setup(t);
  const auth = await login(site);
  const headers = {Cookie: auth.headers.get("Set-Cookie").split(";")[0]};
  const base = "/api/ad-studio/social/";
  site.env.BUFFER_API_KEY = "fixture-worker-buffer-key";
  const sent = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(url,"https://api.buffer.com");
    const {query,variables}=JSON.parse(options.body);
    if(query.includes("organizations"))return Response.json({data:{account:{organizations:[{id:"org",name:"Mock"}]}}});
    if(query.includes("channels("))return Response.json({data:{channels:[{id:"fb",service:"facebook"},{id:"li",service:"linkedin"},{id:"x",service:"twitter"}]}});
    assert.match(query,/createPost/);
    sent.push(variables.input);
    return Response.json({data:{createPost:{post:{id:"post-"+sent.length,status:"scheduled"}}}});
  };
  const make = (kind,url="",targets=[{accountId:"fb",platform:"facebook"},{accountId:"li",platform:"linkedin"}]) => {
    const form=new FormData();
    form.set("title","Static post");form.set("caption","Feed copy");form.set("mode","addToQueue");
    form.set("mediaKind",kind);form.set("targets",JSON.stringify(targets));
    if(url)form.set("mediaUrl",url);
    form.set("captions",JSON.stringify({linkedin:"LinkedIn override"}));
    return form;
  };
  const publish = (form,id=crypto.randomUUID()) => site.request(new Request(origin+base+"publish",{
    method:"POST",headers:{Cookie:headers.Cookie,Origin:origin,"Idempotency-Key":id},body:form
  }));
  const textId=crypto.randomUUID();
  assert.equal((await publish(make("text"),textId)).status,202);
  assert.deepEqual(sent[0].metadata,{facebook:{type:"post"}});
  assert.deepEqual(sent[0].assets,[]);
  assert.deepEqual(sent[1].assets,[]);
  assert.equal(sent[1].text,"LinkedIn override");
  assert.equal((await publish(make("text"),textId)).status,200);
  assert.equal(sent.length,2);
  assert.equal((await publish(make("image","https://media.example.test/ad.png"))).status,202);
  assert.deepEqual(sent[2].metadata,{facebook:{type:"post"}});
  assert.deepEqual(sent[2].assets,[{image:{url:"https://media.example.test/ad.png"}}]);
  assert.deepEqual(sent[3].assets,[{image:{url:"https://media.example.test/ad.png"}}]);
  assert.equal((await publish(make("image","https://media.example.test/ad.mp4"))).status,400);
  assert.equal((await publish(make("text","https://media.example.test/ad.png"))).status,400);
  assert.equal((await publish(make("text","",[{accountId:"x",platform:"twitter"}]))).status,400);
  assert.equal(sent.length,4);
  const history=await (await site.call(base+"history",{headers})).json();
  assert.ok(history.submissions.some(item=>item.mediaKind==="image"));
  assert.ok(history.submissions.some(item=>item.mediaKind==="text"));
  site.env.CLOUDINARY_CLOUD_NAME="test-cloud";
  site.env.CLOUDINARY_API_KEY="1234";
  site.env.CLOUDINARY_API_SECRET="synthetic-signing-secret";
  const ticket=await (await site.call(base+"upload-ticket?kind=image",{headers,body:{}})).json();
  assert.equal(ticket.endpoint,"https://api.cloudinary.com/v1_1/test-cloud/image/upload");
  assert.doesNotMatch(JSON.stringify(ticket),/synthetic-signing-secret/);
});
