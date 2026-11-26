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

test("Stripe creates a $199 session and only a paid session can save a brief", async (t) => {
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
