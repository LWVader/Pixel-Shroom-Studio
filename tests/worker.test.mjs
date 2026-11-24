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

test("Stripe creates a $199 session and only a paid session can save a brief", async (t) => {
  const site = await setup(t);
  const campaign = (body) => site.call("/api/campaign-orders", {body});
  assert.equal((await (await campaign({action: "offers"})).json()).attention, true);

  const checkout = {action: "checkout", offer: "attention", requestId: crypto.randomUUID()};
  const first = await campaign(checkout);
  assert.equal(first.status, 200);
  const {url} = await first.json();
  assert.equal((await (await campaign(checkout)).json()).url, url);
  assert.match(url, /^https:\/\/checkout\.stripe\.com\//);
  const form = site.requests.find((request) => request.method === "POST").form;
  assert.equal(form.get("line_items[0][price_data][unit_amount]"), "19900");
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

test("portfolio drafts stay private and published campaigns can be edited or withdrawn", async (t) => {
  const site = await setup(t);
  const image = await (await site.call("/assets/campaigns/orbit-roast-640.webp")).arrayBuffer();
  const admin = "/api/admin/portfolio";
  const published = "/api/portfolio";
  const id = crypto.randomUUID();
  const body = {id, version: 0, published: false, image: Buffer.from(image).toString("base64"),
    name: "Roast launch", sector: "food", tagline: "A new roast", brief: "Introduce a roast",
    value: "The image makes the product recognizable", alt: "A giant coffee bean", palette: "#D9FF55"};
  assert.equal((await site.call(admin, {body})).status, 401);

  const signed = await login(site);
  const headers = {Cookie: signed.headers.get("Set-Cookie").split(";")[0]};
  const original = await site.call(admin, {body, headers});
  assert.equal(original.status, 200);
  assert.equal((await original.json()).version, 1);
  assert.equal((await site.call(`${published}?id=${id}`)).status, 404);
  assert.equal((await site.call(`${published}/${id}/image`)).status, 404);
  assert.equal((await site.call(`${admin}/${id}/image`, {headers})).status, 200);

  const release = {...body, version: 1, image: null, published: true};
  const live = await site.call(admin, {body: release, headers});
  assert.equal(live.status, 200);
  assert.equal((await live.json()).version, 2);
  const publicData = await (await site.call(published)).json();
  assert.equal(publicData.campaigns[0].id, id);
  assert.equal(publicData.campaigns[0].image_webp, undefined);
  assert.equal((await site.call(`${published}/${id}/image`)).headers.get("Content-Type"), "image/webp");
  assert.equal((await site.call(admin, {body: release, headers})).status, 409);
  assert.equal((await site.call(admin, {body: {...release, version: 2, published: false}, headers})).status, 200);
  assert.equal((await site.call(`${published}?id=${id}`)).status, 404);
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
