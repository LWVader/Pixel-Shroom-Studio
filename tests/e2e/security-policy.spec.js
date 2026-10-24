import { test, expect } from "@playwright/test";
import worker from "../../worker.mjs";
test("CSP permits Cloudflare beacon and nonced injection while blocking other inline scripts", async ({
  page,
}) => {
  const env = {
    ASSETS: {
      fetch: async () =>
        new Response("<html></html>", { headers: { "content-type": "text/html", etag: "old" } }),
    },
  };
  const response = await worker.fetch(
    new Request("https://www.pixelshroomstudio.com/collection.html"),
    env,
  );
  const csp = response.headers.get("content-security-policy");
  const nonce = csp.match(/'nonce-([^']+)'/)[1];
  await page.route("https://static.cloudflareinsights.com/**", (route) =>
    route.fulfill({ contentType: "text/javascript", body: "window.beaconRan=true;" }),
  );
  await page.route("**/csp-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      headers: { "Content-Security-Policy": csp },
      body: `<!doctype html><html><head><title>CSP test</title></head><body><script nonce="${nonce}">window.trustedRan=true;</script><script>window.untrustedRan=true;</script><script src="https://static.cloudflareinsights.com/beacon.min.js/version-fixture"></script></body></html>`,
    }),
  );
  await page.goto("/csp-fixture");
  await expect
    .poll(() => page.evaluate(() => Boolean(window.trustedRan && window.beaconRan)))
    .toBe(true);
  expect(await page.evaluate(() => window.untrustedRan)).toBeUndefined();
});
