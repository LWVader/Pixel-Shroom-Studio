import {createServer} from "node:http";
import {Readable} from "node:stream";
import {createFixture} from "./fixture.mjs";

const origin = "http://127.0.0.1:4173";
const fixture = await createFixture();
const server = createServer(async (request, reply) => {
  try {
    const url = new URL(request.url, origin);
    if (url.pathname === "/__test/configure-storage" && request.method === "POST") {
      const enabled = url.searchParams.get("enabled") === "true";
      fixture.env.SUPABASE_URL = enabled ? "https://fixtureproject.supabase.co" : "";
      fixture.env.SUPABASE_SERVICE_ROLE_KEY = enabled ? "sb_secret_fixture" : "";
      reply.writeHead(204).end();
      return;
    }
    if (url.pathname === "/__test/configure-monthly" && request.method === "POST") {
      const enabled = url.searchParams.get("enabled") === "true";
      fixture.env.CAMPAIGN_MONTHLY_PRICE_ID = enabled ? "price_fixture_monthly" : "";
      fixture.env.CAMPAIGN_BILLING_PORTAL_URL = enabled ? "https://billing.stripe.com/p/login/fixture" : "";
      reply.writeHead(204).end();
      return;
    }
    if (url.pathname === "/__test/complete-checkout" && request.method === "POST") {
      const redirect = fixture.completePayment(url.searchParams.get("session"));
      if (!redirect) {
        reply.writeHead(404).end();
      } else {
        reply.writeHead(200, {"Content-Type": "application/json"}).end(JSON.stringify({redirect}));
      }
      return;
    }

    const method = request.method;
    const body = method === "GET" || method === "HEAD" ? null : Readable.toWeb(request);
    const response = await fixture.request(new Request(url, {
      method, headers: request.headers, body, ...(body ? {duplex: "half"} : {})
    }));
    reply.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body).pipe(reply);
    else reply.end();
  } catch (error) {
    console.error(error);
    reply.writeHead(500).end("Test server failed.");
  }
});
server.listen(4173, "127.0.0.1", () => console.log("Test site at " + origin));
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => server.close(() => fixture.close()));
}
