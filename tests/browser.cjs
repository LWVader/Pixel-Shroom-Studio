const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
(async () => {
  const child = require("node:child_process").spawn(
    process.execPath,
    ["audited/tests/local-server.mjs"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  await new Promise((resolve, reject) => {
    child.stdout.once("data", resolve);
    child.once("error", reject);
  });
  process.on("exit", () => child.kill());
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
    errors = [],
    requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*.supabase.co/**", async (r) => {
    const u = new URL(r.request().url());
    if (u.pathname.endsWith("/articles")) return r.fulfill({ json: [] });
    if (u.pathname.endsWith("/create-checkout")) {
      requests.push(r.request().postDataJSON());
      return r.fulfill({ json: { checkoutUrl: "https://evil.example/payment" } });
    }
    return r.abort();
  });
  await page.goto("http://127.0.0.1:8020/all-artwork.html", { waitUntil: "networkidle" });
  assert.equal(await page.locator(".genre-sample").count(), 9);
  for (const s of await page.locator(".genre-sample").all())
    assert((await s.locator(".art-card").count()) <= 4);
  assert.equal(await page.locator(".art-card").count(), 36);
  assert.equal(await page.locator(".category-nav a").count(), 11);
  assert(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  await page.screenshot({ path: "homepage-desktop.png", fullPage: false });
  const before = await page
    .locator("[data-artwork-id]")
    .evaluateAll((cards) => cards.map((c) => c.dataset.artworkId));
  await page.locator("#shuffle-samples").click();
  const after = await page
    .locator("[data-artwork-id]")
    .evaluateAll((cards) => cards.map((c) => c.dataset.artworkId));
  assert.notDeepEqual(before, after);
  await page.locator("#search").fill("Fantasy artwork 5");
  assert.equal(await page.locator(".art-card").count(), 2);
  await page.locator("#search").fill("");
  assert.equal(await page.locator(".art-card").count(), 36);
  await page.locator(".preview-trigger").first().click();
  assert(await page.locator("dialog").evaluate((d) => d.open));
  await page.keyboard.press("Escape");
  assert(!(await page.locator("dialog").evaluate((d) => d.open)));
  await page.locator("[data-provider=stripe]").first().click();
  await page.waitForFunction(() =>
    document.querySelector(".card-status")?.textContent.includes("unsupported"),
  );
  assert.equal(requests[0].provider, "stripe");
  assert.equal(typeof requests[0].artworkId, "number");
  await page.setViewportSize({ width: 390, height: 844 });
  assert(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  await page.screenshot({ path: "homepage-mobile.png", fullPage: true });
  await page.locator(".mobile summary").click();
  assert(await page.locator(".mobile nav").isVisible());
  for (const slug of [
    "portrait",
    "fantasy",
    "landscape",
    "sci-fi",
    "abstract",
    "dreamscape",
    "dark-fantasy",
    "horror",
    "nft",
  ]) {
    await page.goto("http://127.0.0.1:8020/genre.html?genre=" + slug, { waitUntil: "networkidle" });
    assert.equal(await page.locator(".art-card").count(), 6);
    assert.equal(await page.locator("h1").count(), 1);
    assert(
      (await page.locator("link[rel=canonical]").getAttribute("href")).endsWith("?genre=" + slug),
    );
    assert(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), slug);
    if (slug === "nft") assert.equal(await page.locator("[data-buy]").count(), 0);
  }
  await page.goto("http://127.0.0.1:8020/genre.html?genre=fantasy", { waitUntil: "networkidle" });
  await page.screenshot({ path: "genre-mobile.png", fullPage: true });
  for (const url of [
    "/genres/fantasy.html",
    "/genre/fantasy",
    "/artwork.html",
    "/faq",
    "/genre.html?genre=Fantasy",
    "/genre?genre=fantasy",
  ]) {
    const r = await fetch("http://127.0.0.1:8020" + url, { redirect: "manual" });
    assert.equal(r.status, 301, url);
    const dest = r.headers.get("location");
    const final = await fetch(dest);
    assert.equal(final.status, 200, url);
  }
  for (const url of [
    "/genre.html?genre=bad",
    "/genre.html?genre=fantasy&genre=horror",
    "/unknown-page",
  ])
    assert.equal((await fetch("http://127.0.0.1:8020" + url)).status, 404, url);
  for (const name of [
    "faq",
    "contact",
    "how-it-works",
    "usage-rights",
    "privacy",
    "terms",
    "cookies",
  ]) {
    await page.goto("http://127.0.0.1:8020/all-artwork.html" + name + ".html", {
      waitUntil: "networkidle",
    });
    assert.equal(await page.locator("h1").count(), 1, name);
    assert(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), name);
  }
  console.log(
    JSON.stringify({
      result: "PASS",
      samples: 36,
      genres: 9,
      randomRefresh: true,
      search: true,
      modalKeyboard: true,
      mobileOverflow: false,
      redirects: true,
      invalidRoutes404: true,
      untrustedCheckoutBlocked: true,
      browserErrors: errors,
    }),
  );
  assert.equal(errors.length, 0);
  await browser.close();
  child.kill();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
