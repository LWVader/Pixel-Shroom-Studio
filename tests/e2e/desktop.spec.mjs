import {expect, test} from "@playwright/test";
import {testPassword} from "../fixture.mjs";
import {sampleZip} from "../monthly-zip-fixture.mjs";

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
  expect(sources.every(src => src.startsWith("/assets/service-previews/"))).toBeTruthy();
  for(const name of ["neon-mushroom-mischief","cafe-friends","ceramic-panda-garden","prismatic-dragon","mediterranean-highland-portrait"]){
    expect(sources).toContain("/assets/service-previews/"+name+".webp");
  }
  const highland = page.locator('.asset-examples img[src$="mediterranean-highland-portrait.webp"]');
  expect(await highland.evaluate(img => [img.naturalWidth, img.naturalHeight])).toEqual([480, 853]);
  for(const image of await page.locator(".asset-examples img").all()){
    const valid=await image.evaluate(img=>img.naturalWidth>0 && Math.abs(img.naturalWidth/img.naturalHeight-Number(img.width)/Number(img.height))<.025);
    expect(valid).toBeTruthy();
  }
  await expect(page.locator(".landing-preview img")).toHaveAttribute("src", "/assets/service-previews/ember-orbit.webp");
  await page.getByRole("link", {name: /Explore demo/}).click();
  await expect(page.getByRole("heading", {name: /Awaken.*the dark/})).toBeVisible();
  await expect(page.locator(".hero img")).toHaveAttribute("src", "/assets/service-previews/ember-orbit.webp");
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
  await expect(page.getByRole("heading", {name: "Orders & briefs"})).toBeHidden();
  await page.getByLabel("Administrator password").fill(testPassword);
  await page.getByRole("button", {name: "Sign in", exact: true}).click();
  await expect(page.getByRole("heading", {name: "Orders & briefs"})).toBeVisible();
  await expect(page.getByRole("heading", {name: "Monthly Asset Pack delivery"})).toBeVisible();
  await expect(page.locator("#monthly-configuration")).toContainText("Auto-delivery: disabled");
  await expect(page.getByRole("button", {name: "Publish monthly ZIP"})).toBeDisabled();
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

test("monthly subscription confirms with no creative brief and creates one admin order", async ({page, request, baseURL}) => {
  await request.post("/__test/configure-monthly", {params: {enabled: "true"}});
  try {
    await page.route("https://checkout.stripe.com/c/pay/*", async (route) => {
      const id = new URL(route.request().url()).pathname.split("/").at(-1);
      const complete = await request.post("/__test/complete-checkout", {params: {session: id}});
      expect(complete.ok()).toBeTruthy();
      const {redirect} = await complete.json();
      expect(new URL(redirect).origin).toBe(baseURL);
      await route.fulfill({status: 302, headers: {Location: redirect}});
    });
    await page.goto("/");
    await expect(page.locator("#monthly")).toContainText("No creative brief required");
    await page.getByRole("button", {name: "Subscribe for $49/month"}).click();
    await expect(page.getByRole("heading", {name: "Subscription confirmed."})).toBeVisible();
    await expect(page.locator("#brief-status")).toContainText("10 fresh, randomly themed backgrounds");
    await expect(page.locator("#brief-form")).toBeHidden();
    await expect(page.locator("#addon-panel")).toBeHidden();
    await page.reload();
    await expect(page.getByRole("heading", {name: "Subscription confirmed."})).toBeVisible();
    await page.goto("/admin.html");
    await page.getByLabel("Administrator password").fill(testPassword);
    await page.getByRole("button", {name: "Sign in", exact: true}).click();
    const entry = page.locator("#order-list li").filter({hasText: "Monthly Asset Pack"});
    await expect(entry).toHaveCount(1);
    await entry.getByRole("button", {name: "Open order"}).click();
    const order = page.getByRole("dialog", {name: "Monthly Asset Pack"});
    await expect(order).toBeVisible();
    await expect(order.getByText("Not required", {exact: true})).toBeVisible();
    await expect(order.getByText("10 independent, randomly themed backgrounds per month")).toBeVisible();
    const draft = new URL(await order.getByRole("link", {name: "Compose in Gmail"}).getAttribute("href"));
    expect(draft.searchParams.get("body")).toContain("10 fresh backgrounds");
  } finally {
    await request.post("/__test/configure-monthly", {params: {enabled: "false"}});
  }
});

test("monthly admin accepts a Windows ZIP larger than 20 MiB and registers the pack", async ({page,request}) => {
  await request.post("/__test/configure-storage",{params:{enabled:"true"}});
  try {
    await page.goto("/admin.html");
    await page.getByLabel("Administrator password").fill(testPassword);
    await page.getByRole("button",{name:"Sign in",exact:true}).click();
    await expect(page.locator("#monthly-configuration")).toContainText("Private bucket connected");
    await expect(page.getByRole("button",{name:"Publish monthly ZIP"})).toBeEnabled();
    await page.getByLabel("Pack month").fill("2027-02");
    await expect(page.locator("#monthly-recovery-help")).toContainText("No stored ZIP for 2027-02");
    await expect(page.getByRole("button",{name:"Register existing ZIP"})).toBeDisabled();
    const buffer=sampleZip(10,{folder:true,size:2400000});
    await page.locator("#monthly-upload-form input[type=file]").setInputFiles({name:"Windows Monthly Pack.zip",mimeType:"application/zip",buffer});
    await expect(page.locator("#monthly-file-selection")).toContainText("Windows Monthly Pack.zip");
    await expect(page.locator("#monthly-file-selection")).toContainText("22.89 MiB");
    page.once("dialog",dialog=>dialog.accept());
    await page.getByRole("button",{name:"Publish monthly ZIP"}).click();
    await expect(page.locator("#monthly-upload-status")).toContainText("Published 2027-02: 10 images",{timeout:20000});
    await expect(page.locator("#monthly-packs")).toContainText("2027-02");
    await expect(page.locator("#monthly-packs")).toContainText("Published");
    await expect(page.locator("#monthly-storage-files")).toContainText("2027-02.zip");
    await expect(page.locator("#monthly-recovery-help")).toContainText("already published");
    await page.getByRole("button",{name:"Refresh delivery status"}).click();
    await expect(page.locator("#monthly-packs")).toContainText("2027-02");
  } finally {await request.post("/__test/configure-storage",{params:{enabled:"false"}});}
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

test("adaptive template preserves complete 4:5 artwork, full canvas and exported frames", async ({page}) => {
  await page.goto("/admin.html");
  await page.getByLabel("Administrator password").fill(testPassword);
  await page.getByRole("button", {name: "Sign in", exact: true}).click();
  await page.getByRole("link", {name: "Open AD Studio"}).click();
  // A unique color at each corner makes cropping or misplaced artwork visible.
  const data = await page.evaluate(() => {
    const source = document.createElement("canvas");
    source.width = 400;
    source.height = 500;
    const ctx = source.getContext("2d");
    for (const [color, x, y] of [["#ff0000", 0, 0], ["#00ff00", 200, 0], ["#0000ff", 0, 250], ["#ffff00", 200, 250]]) {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 200, 250);
    }
    return source.toDataURL("image/png").split(",")[1];
  });
  await page.getByLabel("Aspect ratio").selectOption("portrait");
  await page.locator("#edit-marketing-copy").click();
  await page.locator("#headline").fill("Sample artwork.");
  await page.locator("#bgUpload").setInputFiles({name: "finished-ad-4x5.png", mimeType: "image/png", buffer: Buffer.from(data, "base64")});
  await expect(page.locator("#artworkPlacement")).toHaveValue("template");
  await expect(page.locator("#bgFit")).toHaveValue("contain");
  const templateCorners = () => page.locator("#scene").evaluate(canvas => {
    const ctx = canvas.getContext("2d"), scale = canvas.width / 864;
    const height = canvas.height / scale;
    const h = Math.min(752 / .8, height - 148 - 132 - 128);
    const w = .8 * h, x = (864 - w) / 2, y = 132;
    return [[x + 5, y + 5], [x + w - 5, y + 5], [x + 5, y + h - 5], [x + w - 5, y + h - 5]]
      .map(([px, py]) => Array.from(ctx.getImageData(Math.round(px * scale), Math.round(py * scale), 1, 1).data).slice(0, 3).map(v => v > 128 ? 255 : 0));
  });
  const expected = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]];
  await expect.poll(templateCorners).toEqual(expected);
  const stage = page.locator(".stage");
  expect((await stage.boundingBox()).height).toBeGreaterThanOrEqual(840);
  expect(await page.locator("#scene").evaluate(canvas => {
    const rect = canvas.getBoundingClientRect();
    const bounds = canvas.closest(".stage").getBoundingClientRect();
    return rect.top >= bounds.top && rect.bottom <= bounds.bottom && rect.left >= bounds.left &&
      rect.right <= bounds.right && Math.abs(rect.width / rect.height - .8) < .01;
  })).toBe(true);
  await page.locator("#artwork-title").click();
  await expect(page.locator("#bgZoom")).toBeDisabled();
  await page.locator("#artworkPlacement").selectOption("canvas");
  await expect(page.locator("#bgZoom")).toHaveValue("100");
  await expect(page.locator("#bgDim")).toHaveValue("0");
  const pixels = () => page.locator("#scene").evaluate(canvas => {
    const ctx = canvas.getContext("2d");
    const points = [[5, 5], [canvas.width - 6, 5], [5, canvas.height - 6], [canvas.width - 6, canvas.height - 6]];
    return points.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data).slice(0, 3).map(v => v > 128 ? 255 : 0));
  });
  await expect.poll(pixels).toEqual(expected);

  const [download] = await Promise.all([
    page.waitForEvent("download"), page.getByRole("button", {name: "Download PNG frame"}).click()
  ]);
  const {readFile} = await import("node:fs/promises");
  const png = await readFile(await download.path());
  expect(png.readUInt32BE(16)).toBe(1080);
  expect(png.readUInt32BE(20)).toBe(1350);
  const exported = await page.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], {type: "image/png"}));
    const canvas = document.createElement("canvas");
    canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    return [[5, 5], [canvas.width - 6, 5], [5, canvas.height - 6], [canvas.width - 6, canvas.height - 6]]
      .map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data).slice(0, 3).map(v => v > 128 ? 255 : 0));
  }, png.toString("base64"));
  expect(exported).toEqual(expected);

  // Other output ratios retain the entire image, while the original template
  // is still available for users who want editor-generated copy and logos.
  await page.getByLabel("Aspect ratio").selectOption("story");
  await expect(page.locator("#scene")).toHaveAttribute("height", "1920");
  await page.locator("#artworkPlacement").selectOption("template");
  await expect(page.locator("#bgFit")).toHaveValue("contain");
  await page.locator("#artworkPlacement").selectOption("canvas");
  await page.getByLabel("Aspect ratio").selectOption("portrait");
  await expect.poll(pixels).toEqual(expected);
});

test("auto-height post expands dynamically for artwork and multiline copy without reducing the selected font", async ({page}) => {
  await page.goto("/admin.html");
  await page.getByLabel("Administrator password").fill(testPassword);
  await page.getByRole("button", {name: "Sign in", exact: true}).click();
  await page.getByRole("link", {name: "Open AD Studio"}).click();
  await expect(page.getByLabel("Aspect ratio")).toHaveValue("auto");
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 400; canvas.height = 500;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ed2500"; ctx.fillRect(0, 0, 400, 500);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.locator("#bgUpload").setInputFiles({name: "portrait.png", mimeType: "image/png", buffer: Buffer.from(png, "base64")});
  await page.locator("#edit-marketing-copy").click();
  const caption = page.locator("#headline");
  await caption.fill("Short caption.");
  await expect(page.locator("#captionFit")).toContainText("40px");
  const canvas = page.locator("#scene");
  await expect(canvas).toHaveAttribute("height", "1686");
  const shortHeight = Number(await canvas.getAttribute("height"));
  const longCaption = [
    "BORING FEEDS END HERE.",
    "Give your social media a fresh creative edge.", "",
    "10 new AI-generated backgrounds every month.",
    "Unique styles for every promotion.",
    "Ready for social media, advertising and branding.",
    "Spend less time creating visuals.",
    "All for just $49/month."
  ].join("\n");
  await caption.fill(longCaption);
  await expect.poll(async () => Number(await canvas.getAttribute("height"))).toBeGreaterThan(shortHeight + 200);
  await expect(page.locator("#captionFit")).toHaveText("Caption uses 40px on the ad.");
  const autoHeight = Number(await canvas.getAttribute("height"));
  expect(autoHeight % 2).toBe(0);
  // Full-width source art, including top and bottom edges, and complete copy.
  const sample = await canvas.evaluate(c => {
    const ctx = c.getContext("2d"), scale = c.width / 864;
    return [[60, 136], [804, 1068]].map(([x,y]) => Array.from(ctx.getImageData(Math.round(x*scale),Math.round(y*scale),1,1).data).slice(0,3));
  });
  expect(sample.every(([r,g,b]) => r > 180 && g < 100 && b < 60)).toBe(true);
  const [download] = await Promise.all([page.waitForEvent("download"),page.getByRole("button",{name:"Download PNG frame"}).click()]);
  const {readFile} = await import("node:fs/promises");
  const exported = await readFile(await download.path());
  expect(exported.readUInt32BE(16)).toBe(1080);
  expect(exported.readUInt32BE(20)).toBe(autoHeight);
  await page.getByLabel("Aspect ratio").selectOption("portrait");
  await expect(canvas).toHaveAttribute("height", "1350");
  await expect(page.locator("#captionFit")).toHaveText("Caption uses 40px on the ad.");
  await page.getByRole("button", {name: "Auto fit artwork & text"}).click();
  await expect(canvas).toHaveAttribute("height", String(autoHeight));
  await caption.fill("Short caption.");
  await expect(canvas).toHaveAttribute("height", String(shortHeight));
});
