import {expect, test} from "@playwright/test";
import {testPassword} from "../fixture.mjs";

test.beforeEach(async ({context}) => {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") await route.continue();
    else await route.abort();
  });
});

test("portfolio filter and keyboard dismissal", async ({page}) => {
  await page.goto("/");
  await expect.poll(() => page.locator(".hero-background img").evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator(".work-card:visible")).toHaveCount(5);
  await expect(page.locator('.work-card img[src^="/assets/campaign-examples/"]')).toHaveCount(5);
  await page.getByRole("button", {name: "Gaming", exact: true}).click();
  await expect(page.locator(".work-card:visible")).toHaveCount(1);
  await page.getByRole("button", {name: /Mossbyte Games/}).click();
  await expect(page.getByRole("dialog", {name: "Mossbyte Games"})).toBeVisible();
  await expect(page.locator(".case-image")).toHaveAttribute("src", "/assets/campaign-examples/mossbyte.webp");
  await expect(page.locator(".mockup-image")).toHaveAttribute("src", /\/assets\/campaign-examples\/mossbyte\.webp$/);
  await expect.poll(() => page.locator(".case-image").evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator("#case-palette li")).toHaveCount(4);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", {name: "All work", exact: true}).click();
  await expect(page.locator(".work-card:visible")).toHaveCount(5);
});

test("homepage shows both service offers and independent fictional examples", async ({page}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", {name: "One-page landing page"})).toBeVisible();
  await expect(page.getByRole("heading", {name: "Keep your feed fresh."})).toBeVisible();
  await expect(page.locator("#monthly .price")).toContainText("$49");
  await expect(page.getByRole("link", {name: "Ask about subscribing"})).toBeVisible();
  await expect(page.locator("[data-checkout=monthly]")).toBeHidden();
  for (const img of await page.locator(".asset-examples img, .landing-preview img").all()) {
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate(element => element.naturalWidth)).toBeGreaterThan(0);
  }
  await expect(page.locator(".asset-examples img")).toHaveCount(10);
  await expect(page.locator(".asset-examples a")).toHaveCount(10);
  const sources = await page.locator(".asset-examples img").evaluateAll(images => images.map(image => image.getAttribute("src")));
  expect(new Set(sources).size).toBe(10);
  await page.getByRole("link", {name: /Explore demo/}).click();
  await expect(page.getByRole("heading", {name: /Awaken.*the dark/})).toBeVisible();
  await page.getByRole("link", {name: /Meet the roast/}).click();
  await expect(page).toHaveURL(/#roast$/);
});

test("mock Stripe checkout, campaign brief and footer admin delivery", async ({page, request, baseURL}) => {
  await page.route("https://checkout.stripe.com/c/pay/*", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1);
    const complete = await request.post("/__test/complete-checkout", {params: {session: id}});
    expect(complete.ok()).toBeTruthy();
    const {redirect} = await complete.json();
    expect(new URL(redirect).origin).toBe(baseURL);
    await route.fulfill({status: 302, headers: {Location: redirect}});
  });

  await page.goto("/");
  await page.getByRole("button", {name: "Buy the Attention Pack"}).click();
  await expect(page).toHaveURL(/brief\.html\?session_id=cs_test_/);
  await page.getByLabel("Business or project name").fill("Playwright Roaster");
  await page.getByLabel("Industry").fill("Coffee");
  await page.getByLabel("Three words for the vibe").fill("Bold crisp nocturnal");
  await page.getByLabel("Surprise me with the colors").check();
  await page.getByLabel("What are you launching?").fill("A new winter roast.");
  await page.getByRole("button", {name: "Send the campaign brief"}).click();
  await expect(page.getByRole("heading", {name: "Brief received."})).toBeVisible();
  await expect(page.locator("#brief-status")).toContainText("weirichloren@gmail.com");
  await expect(page.getByRole("button", {name: "Continue to Stripe"})).toBeDisabled();
  await page.getByLabel("Want a basic one-page landing page to match your brand? Add for $199.").check();
  await page.getByRole("button", {name: "Continue to Stripe"}).click();
  await expect(page.getByRole("heading", {name: "Landing page added."})).toBeVisible();

  await page.goto("/");
  await page.getByRole("link", {name: "Studio administrator sign-in"}).click();
  await expect(page).toHaveURL("/admin.html");
  await expect(page.getByRole("heading", {name: "Administrator sign-in"})).toBeVisible();
  await expect(page.getByRole("heading", {name: "Submitted briefs"})).toBeHidden();
  await page.getByLabel("Administrator password").fill(testPassword);
  await page.getByRole("button", {name: "Sign in", exact: true}).click();
  await expect(page.getByRole("heading", {name: "Submitted briefs"})).toBeVisible();
  await page.getByRole("button", {name: "Check Stripe connection"}).click();
  await expect(page.getByText("Stripe Checkout API reachable in test mode.")).toBeVisible();

  const entry = page.getByRole("listitem").filter({hasText: "Playwright Roaster"});
  await entry.getByRole("button", {name: "Open brief"}).click();
  const order = page.getByRole("dialog", {name: "Playwright Roaster"});
  await expect(order).toBeVisible();
  await order.getByLabel("Production stage").selectOption("ready");
  await order.getByRole("button", {name: "Update stage"}).click();
  await expect(order.getByText("Production stage updated.")).toBeVisible();
  const compose = new URL(await order.getByRole("link", {name: "Compose in Gmail"}).getAttribute("href"));
  expect(decodeURIComponent(compose.pathname)).toContain("weirichloren@gmail.com");
  expect(compose.searchParams.get("to")).toBe("campaign-buyer@example.test");
  page.once("dialog", (dialog) => dialog.accept());
  await order.getByRole("button", {name: "Mark email sent"}).click();
  await expect(order.getByText("Email marked as sent.")).toBeVisible();
  await order.getByRole("button", {name: "Close order"}).click();

  await page.getByRole("link", {name: "Open AD Studio"}).click();
  await expect(page.getByRole("link", {name: "Back to Campaign Admin"})).toBeVisible();
  await page.getByRole("link", {name: "Back to Campaign Admin"}).click();
  await page.getByRole("button", {name: "Sign out"}).click();
  await expect(page.getByRole("heading", {name: "Administrator sign-in"})).toBeVisible();
  expect((await page.request.get("/api/admin/campaigns")).status()).toBe(401);
});

test("publishes a campaign and starts a marketing ad from its artwork", async ({page, request}) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/admin.html");
  await page.getByLabel("Administrator password").fill(testPassword);
  await page.getByRole("button", {name: "Sign in", exact: true}).click();
  await page.getByRole("button", {name: "New campaign", exact: true}).click();
  await page.getByLabel("Campaign name").fill("Twilight Release");
  const industry = page.getByLabel("Industry");
  await expect(industry.locator('option[value="games"]')).toHaveText("Gaming");
  await industry.selectOption("technology");
  await page.getByLabel("Tagline").fill("Taste the night");
  await page.getByLabel("Campaign brief").fill("Launch a new coffee subscription app.");
  await page.getByLabel("Why this creative works").fill("A giant coffee bean makes the app's purpose clear.");
  await page.getByLabel("Artwork description").fill("A giant coffee bean floating above a city.");
  const imageData = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 360;
    canvas.height = 640;
    const context = canvas.getContext("2d");
    context.fillStyle = "purple";
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.locator('input[name="image"]').setInputFiles({name: "portrait.png", mimeType: "image/png", buffer: Buffer.from(imageData, "base64")});
  await page.getByRole("button", {name: "Save as draft"}).click();
  await expect(page.getByText("Campaign saved as a draft.")).toBeVisible();
  expect((await (await request.get("/api/portfolio")).json()).campaigns).toHaveLength(0);
  const entry = page.getByRole("listitem").filter({hasText: "Twilight Release"});
  await entry.getByRole("button", {name: "Edit"}).click();
  await page.getByRole("button", {name: "Publish to site"}).click();
  await expect(page.getByText("Campaign published to the live portfolio.")).toBeVisible();
  const view = await entry.getByRole("link", {name: "View live"}).getAttribute("href");
  const create = await entry.getByRole("link", {name: "Create ad"}).getAttribute("href");
  await page.goto(view);
  await expect(page.getByRole("heading", {name: "Twilight Release"})).toBeVisible();
  await expect(page.getByText("Taste the night")).toBeVisible();
  await expect(page.locator(".campaign-art img")).toHaveCSS("object-fit", "contain");
  await page.getByRole("link", {name: "All campaigns"}).click();
  await page.getByRole("button", {name: "Technology, Software & SaaS", exact: true}).click();
  await expect(page.locator(".work-card:visible")).toHaveCount(1);
  const portrait = page.locator(".work-card:visible img");
  await expect(portrait).toHaveCSS("object-fit", "contain");
  await expect.poll(() => portrait.evaluate((img) => img.naturalHeight)).toBe(640);
  await page.getByRole("button", {name: /Twilight Release/}).click();
  await expect(page.locator(".case-image")).toHaveCSS("object-fit", "contain");
  await expect(page.getByRole("link", {name: "Open shareable campaign page"})).toHaveAttribute("href", view);
  await page.goto(create);
  await expect(page.getByText("Template loaded. Edit the copy, then export or publish.")).toBeVisible();
  await expect(page.locator("#headline")).toHaveValue("Twilight Release\nTaste the night");
  await expect(page.getByLabel("Creative layout")).toHaveValue("marketing");
  await expect(page.locator("#bgFit")).toHaveValue("contain");
  await expect(page.locator("#publishCaption")).toHaveValue(new RegExp(view + "$"));
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", {name: "Download PNG frame"}).click()
  ]);
  expect(download.suggestedFilename()).toBe("campaign-ad.png");
  await page.getByLabel("Creative layout").selectOption("popout");
  await expect(page.locator("#characterSection")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("AD Studio export and publishing validation share the editor state", async ({page}) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/admin.html");
  await page.getByLabel("Administrator password").fill(testPassword);
  await page.getByRole("button", {name: "Sign in", exact: true}).click();
  await page.getByRole("link", {name: "Open AD Studio"}).click();
  await page.getByLabel("Aspect ratio").selectOption("story");
  await page.getByLabel("Show 9:16 safe zone").check();
  await expect(page.locator("#safe-zone-guide")).toBeVisible();
  const image = page.getByRole("img", {name: "Animated advertisement preview"});
  await expect(image).toHaveAttribute("width", "1080");
  await expect(image).toHaveAttribute("height", "1920");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", {name: "Download PNG frame"}).click()
  ]);
  const {readFile} = await import("node:fs/promises");
  const png = await readFile(await download.path());
  expect(png.readUInt32BE(16)).toBe(1080);
  expect(png.readUInt32BE(20)).toBe(1920);

  await page.route("**/api/ad-studio/social/config", route => route.fulfill({
    json: {configured: true, platforms: [{id: "bluesky", accountId: "fixture", name: "Bluesky", label: "Studio", connected: true}]}
  }));
  await page.getByRole("button", {name: "Publish to social"}).click();
  await page.getByRole("checkbox", {name: /Bluesky/}).check();
  await page.locator("#captionOverridesSection > summary").click();
  const url = page.locator("#publicMediaUrl");
  await url.fill("http://example.test/ad.mp4");
  await expect(url).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#sendSocial")).toBeDisabled();
  await url.fill("https://example.test/ad.mp4");
  await expect(page.locator("#sendSocial")).toBeEnabled();
  await page.getByLabel("Bluesky caption").fill("a".repeat(301));
  await expect(page.locator("#channelLengthWarning")).toContainText("Bluesky");
  await expect(page.locator("#sendSocial")).toBeDisabled();
  await page.getByLabel("Bluesky caption").fill("A short caption");
  await expect(page.locator("#sendSocial")).toBeEnabled();
  expect(errors).toEqual([]);
});
