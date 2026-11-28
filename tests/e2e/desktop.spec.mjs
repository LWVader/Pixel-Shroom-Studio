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
  await expect(page.locator("#pack .price")).toContainText("$79");
  await expect(page.locator("#landing .price")).toContainText("$199");
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
  await expect(page.locator("#serviceNotice")).toContainText("Buffer connected");
  await expect(page.locator("#bufferSetup")).not.toHaveAttribute("open", "");
  await expect(page.locator("#bufferConnectForm")).toHaveCount(1);
  await expect(page.locator("#connectSocial")).toHaveCount(0);
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

test("social formats balance long copy and portrait artwork without changing export dimensions", async ({page}) => {
  await page.goto("/admin.html");
  await page.getByLabel("Administrator password").fill(testPassword);
  await page.getByRole("button", {name: "Sign in", exact: true}).click();
  await page.getByRole("link", {name: "Open AD Studio"}).click();
  const ratio = page.getByLabel("Aspect ratio");
  await expect(ratio).toHaveValue("portrait");
  await expect(ratio.locator("option")).toHaveCount(3);
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 400; canvas.height = 500;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ed2500"; ctx.fillRect(0, 0, 400, 500);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.locator("#bgUpload").setInputFiles({name: "portrait.png", mimeType: "image/png", buffer: Buffer.from(png, "base64")});
  await page.locator("#edit-marketing-copy").click();
  const caption = page.locator("#headline"), canvas = page.locator("#scene");
  const longCaption = [
    "🍄 BORING FEEDS END HERE.", "",
    "Give your social media a fresh creative edge with the Pixel Shroom Studio Monthly Asset Pack.", "",
    "🎨 10 new AI-generated backgrounds every month",
    "🌈 Diverse themes and imaginative worlds",
    "✨ Add your own headlines, branding and promotional messages",
    "🚀 Spend less time creating backgrounds from scratch", "",
    "All for just **$49/month.**", "",
    "Good ads. Weird worlds. Unforgettable visuals.", "",
    "👉 Explore the possibilities at https://www.pixelshroomstudio.com/", "",
    "#PixelShroomStudio #SocialMediaMarketing #CreativeAdvertising #DigitalArt #ContentCreation"
  ].join("\n");
  await caption.fill(longCaption);
  const redBounds = () => canvas.evaluate(c => {
    const {data} = c.getContext("2d").getImageData(0, 0, c.width, c.height);
    let left=c.width,top=c.height,right=-1,bottom=-1;
    // The artwork is a large solid red region. Ignore small red emoji
    // glyphs in the caption when measuring its aspect ratio.
    for(let y=0;y<c.height;y+=2) {
      let runStart=-1;
      for(let x=0;x<=c.width;x+=2){
        const i=(y*c.width+x)*4;
        const isRed=x<c.width&&data[i]>180&&data[i+1]<100&&data[i+2]<60;
        if(isRed){if(runStart<0)runStart=x;}
        else if(runStart>=0){
          if(x-runStart>80){left=Math.min(left,runStart);right=Math.max(right,x-2);top=Math.min(top,y);bottom=Math.max(bottom,y);}
          runStart=-1;
        }
      }
    }
    let colorfulIcons=0;
    const scale=c.width/864;
    const buttonY=c.height===1920?(c.height/scale*.77-115)*scale:c.height-148*scale;
    for(let y=Math.round(132*scale);y<buttonY;y++){
      for(let x=Math.round(56*scale);x<Math.round(808*scale);x++){
        if(x>=left-2&&x<=right+2&&y>=top-2&&y<=bottom+2)continue;
        const i=(y*c.width+x)*4,r=data[i],g=data[i+1],b=data[i+2];
        if(Math.max(r,g,b)>160&&Math.min(r,g,b)<100&&Math.max(r,g,b)-Math.min(r,g,b)>100)colorfulIcons++;
      }
    }
    return {width:right-left+1,height:bottom-top+1,colorfulIcons,left,top};
  });
  for (const [format,height,minArtworkHeight] of [["portrait",1350,.43],["square",1080,.43],["story",1920,.28]]) {
    await ratio.selectOption(format);
    await expect(canvas).toHaveAttribute("height", String(height));
    await expect(page.locator("#captionFit")).toContainText("Balanced image and copy at");
    await expect(page.locator("#fit-status")).toBeEmpty();
    expect(Number((await page.locator("#captionFit").textContent()).match(/at (\d+)px/)[1])).toBeGreaterThanOrEqual(18);
    await expect.poll(async () => (await redBounds()).height).toBeGreaterThan(height*minArtworkHeight);
    const bounds=await redBounds();
    expect(Math.abs(bounds.width/bounds.height-.8)).toBeLessThan(.02);
    expect(bounds.colorfulIcons).toBeGreaterThan(30);
    if (format === "portrait" || format === "square") expect(bounds.left).toBeLessThan(100);
    expect(await canvas.getAttribute("width")).toBe("1080");
  }
  await ratio.selectOption("portrait");
  await expect(canvas).toHaveAttribute("height", "1350");
  const [download] = await Promise.all([page.waitForEvent("download"),page.getByRole("button",{name:"Download PNG frame"}).click()]);
  const {readFile} = await import("node:fs/promises");
  const exported = await readFile(await download.path());
  expect(exported.readUInt32BE(16)).toBe(1080);
  expect(exported.readUInt32BE(20)).toBe(1350);
  await caption.fill("Short caption.");
  await expect(page.locator("#captionFit")).toHaveText("Caption uses 40px on the ad.");
  await expect.poll(async () => (await redBounds()).height).toBeGreaterThan(700);
  await caption.fill("A\n".repeat(299));
  await expect(page.locator("#fit-status")).toContainText("Too much on-image text");
  await page.getByRole("button",{name:"Download PNG frame"}).click();
  await expect(page.locator("#toast")).toContainText("Shorten the on-image copy before exporting");
});

test("X and Facebook/LinkedIn publish independently and reuse the same video", async ({page}) => {
  const errors = [], requests = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/admin.html");
  await page.getByLabel("Administrator password").fill(testPassword);
  await page.getByRole("button", {name: "Sign in", exact: true}).click();
  await page.getByRole("link", {name: "Open AD Studio"}).click();
  await page.route("**/api/ad-studio/social/config", route => route.fulfill({json: {
    configured: true, bufferSource: "worker", secureStorage: false, uploadReady: false,
    platforms: [
      {id:"twitter",accountId:"x",name:"X",label:"Studio X",connected:true},
      {id:"facebook",accountId:"fb",name:"Facebook",label:"Studio FB",connected:true},
      {id:"linkedin",accountId:"li",name:"LinkedIn",label:"Studio LI",connected:true}
    ]
  }}));
  await page.route("**/api/ad-studio/social/publish", async route => {
    const request = route.request();
    const form = await new Response(request.postDataBuffer(), {headers: {"Content-Type": request.headers()["content-type"]}}).formData();
    const targets = JSON.parse(form.get("targets"));
    requests.push({id:request.headers()["idempotency-key"],targets,media:form.get("mediaUrl"),captions:JSON.parse(form.get("captions"))});
    await route.fulfill({json:{status:"submitted",message:"Mock queued",results:targets.map(t=>({platform:t.platform,status:"scheduled"}))}});
  });
  await page.getByRole("button", {name:"Publish to social"}).click();
  const x=page.locator("#sendSocialX"), other=page.locator("#sendSocial"), url=page.locator("#publicMediaUrl");
  await expect(x).toBeDisabled();
  await expect(other).toBeDisabled();
  await page.getByRole("checkbox",{name:/Facebook/}).check();
  await expect(other).toBeEnabled();
  await expect(x).toBeDisabled();
  await other.click();
  await expect(page.locator("#publishStatus")).toContainText("video hosting is not configured");
  expect(requests).toHaveLength(0);
  await page.getByRole("checkbox",{name:/LinkedIn/}).check();
  await page.getByRole("checkbox",{name:/X · Studio X/}).check();
  await expect(x).toBeEnabled();
  await expect(other).toBeEnabled();
  await url.fill("https://media.example.test/ad.mp4");
  await page.locator("#captionOverridesSection > summary").click();
  await page.getByLabel("X caption").fill("a".repeat(281));
  await expect(x).toBeDisabled();
  await expect(other).toBeEnabled();
  await other.click();
  await expect(page.locator("#publishStatus")).toContainText("Mock queued");
  expect(requests[0].targets.map(t=>t.platform)).toEqual(["facebook","linkedin"]);
  await expect(other).toBeDisabled();
  await expect(url).toHaveValue("https://media.example.test/ad.mp4");
  await page.getByLabel("X caption").fill("Short X caption");
  await expect(x).toBeEnabled();
  await expect(other).toBeDisabled();
  await x.click();
  await expect(x).toBeDisabled();
  await expect(page.locator("#xPublishReady")).toContainText("Already submitted");
  expect(requests).toHaveLength(2);
  expect(requests[1].targets.map(t=>t.platform)).toEqual(["twitter"]);
  expect(requests[1].captions).toEqual({twitter:"Short X caption"});
  expect(requests[1].media).toBe(requests[0].media);
  expect(requests[1].id).not.toBe(requests[0].id);
  expect(errors).toEqual([]);
});

test("static feed previews and dedicated post button keep video publishing separate", async ({page}) => {
  const errors=[], requests=[], uploads=[];
  let uploadReady=false;
  page.on("pageerror",e=>errors.push(e.message));
  await page.goto("/admin.html");
  await page.getByLabel("Administrator password").fill(testPassword);
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await page.getByRole("link",{name:"Open AD Studio"}).click();
  await page.route("**/api/ad-studio/social/config",route=>route.fulfill({json:{
    configured:true,bufferSource:"worker",secureStorage:false,uploadReady,uploadMode:uploadReady?"direct":null,
    platforms:[{id:"facebook",accountId:"fb",name:"Facebook",label:"Studio FB",connected:true},
      {id:"linkedin",accountId:"li",name:"LinkedIn",label:"Studio LI",connected:true},
      {id:"twitter",accountId:"x",name:"X",label:"Studio X",connected:true}]
  }}));
  await page.route("**/api/ad-studio/social/upload-ticket?kind=image",route=>route.fulfill({json:{
    endpoint:"https://api.cloudinary.com/v1_1/test-cloud/image/upload",fields:{public_id:"static-image-fixture",signature:"fixture"}
  }}));
  await page.route("https://api.cloudinary.com/v1_1/test-cloud/image/upload",async route=>{
    const request=route.request();
    const body=await new Response(request.postDataBuffer(),{headers:{"Content-Type":request.headers()["content-type"]}}).formData();
    uploads.push({type:body.get("file").type,size:body.get("file").size});
    await route.fulfill({json:{public_id:"static-image-fixture",secure_url:"https://res.cloudinary.com/test-cloud/image/upload/static-image-fixture.png"}});
  });
  await page.route("**/api/ad-studio/social/publish",async route=>{
    const request=route.request();
    const form=await new Response(request.postDataBuffer(),{headers:{"Content-Type":request.headers()["content-type"]}}).formData();
    const targets=JSON.parse(form.get("targets"));
    requests.push({kind:form.get("mediaKind"),media:form.get("mediaUrl"),targets});
    await route.fulfill({json:{status:"submitted",message:"Mock static post",results:targets.map(t=>({platform:t.platform,status:"scheduled"}))}});
  });
  await page.getByRole("button",{name:"Publish to social"}).click();
  await expect(page.locator("#publishPreview")).toBeVisible();
  await expect(page.locator("#static-post-title")).toBeVisible();
  await expect(page.locator("#staticCaptureStatus")).toContainText("PNG");
  await expect(page.locator("#fbPreviewImage")).toBeVisible();
  await expect(page.locator("#liPreviewImage")).toBeHidden();
  await expect(page.locator("#downloadStill")).toBeEnabled();
  const viewerWidth=(await page.locator("#fbFeedViewer").boundingBox()).width;
  const videoWidth=(await page.locator("#publishPreview").boundingBox()).width;
  expect(Math.abs(viewerWidth-videoWidth)).toBeLessThan(5);
  const staticButton=page.locator("#sendStaticPost");
  await expect(staticButton).toBeDisabled();
  await page.getByRole("checkbox",{name:/Facebook/}).check();
  await page.getByRole("checkbox",{name:/LinkedIn/}).check();
  await page.getByRole("checkbox",{name:/X · Studio X/}).check();
  await expect(staticButton).toBeEnabled();
  await expect(page.locator("#fbPreviewName")).toHaveText("Studio FB");
  await expect(page.locator("#liPreviewName")).toHaveText("Studio LI");
  await expect(page.locator("#staticBufferStatus")).toContainText("Facebook · Studio FB · Connected");
  await page.locator("#staticDestination").selectOption("li");
  await expect(page.locator("#fbFeedViewer")).toBeHidden();
  await expect(page.locator("#liFeedViewer")).toBeVisible();
  await expect(page.locator("#staticBufferStatus")).toContainText("LinkedIn · Studio LI · Connected");
  await expect(staticButton).toHaveText("Queue post for LinkedIn");
  await staticButton.click();
  await expect(page.locator("#staticPostStatus")).toContainText("No post was sent");
  expect(requests).toHaveLength(0);
  await page.locator("#staticPostMode").selectOption("text");
  await expect(page.locator("#liPreviewImage")).toBeHidden();
  await expect(page.locator("#staticPostReady")).toContainText("no media hosting needed");
  await staticButton.click();
  await expect(page.locator("#staticPostStatus")).toContainText("Mock static post");
  expect(requests[0]).toEqual({kind:"text",media:null,targets:[{platform:"linkedin",accountId:"li"}]});
  await page.locator("#staticDestination").selectOption("fb");
  await expect(page.locator("#fbFeedViewer")).toBeVisible();
  await expect(page.locator("#liFeedViewer")).toBeHidden();
  await page.locator("#staticPostMode").selectOption("image");
  await page.locator("#staticImageUrl").fill("https://media.example.test/ad.mp4");
  await expect(staticButton).toBeDisabled();
  await page.locator("#staticImageUrl").fill("https://media.example.test/ad.png");
  await expect(staticButton).toBeEnabled();
  await staticButton.click();
  await expect(page.locator("#staticPostStatus")).toContainText("Mock static post");
  expect(requests[1].kind).toBe("image");
  expect(requests[1].targets).toEqual([{platform:"facebook",accountId:"fb"}]);
  expect(requests[1].media).toBe("https://media.example.test/ad.png");
  uploadReady=true;
  await page.locator("#refreshAccounts").click();
  await expect(page.locator("#mediaSetupSummary")).toContainText("connected");
  await page.locator("#staticImageUrl").fill("");
  await expect(page.locator("#staticPostReady")).toContainText("automatically");
  await staticButton.click();
  await expect.poll(()=>requests.length).toBe(3);
  expect(uploads).toHaveLength(1);
  expect(uploads[0].type).toBe("image/png");
  expect(uploads[0].size).toBeGreaterThan(1000);
  expect(requests[2].kind).toBe("image");
  expect(requests[2].media).toContain("/image/upload/static-image-fixture.png");
  await expect(page.locator("#sendSocialX")).toBeEnabled();
  await expect(page.locator("#sendSocial")).toBeEnabled();
  await page.getByRole("checkbox",{name:/Facebook/}).uncheck();
  await expect(page.locator("#liFeedViewer")).toBeVisible();
  await expect(page.locator("#fbFeedViewer")).toBeHidden();
  await expect(page.locator("#staticDestination")).toHaveValue("li");
  await page.reload();
  await expect(page.locator("#staticCaptureStatus")).toContainText("PNG");
  await expect(page.locator("#fbPreviewImage")).toBeVisible();
  expect(errors).toEqual([]);
});

test("Canvix layers use the existing canvas, project files and publish preview", async ({page}) => {
  const errors=[];
  page.on("pageerror", e=>errors.push(e.message));
  await page.goto("/admin.html");
  await page.getByLabel("Administrator password").fill(testPassword);
  await page.getByRole("button", {name:"Sign in", exact:true}).click();
  await page.getByRole("link", {name:"Open AD Studio"}).click();
  await page.getByLabel("Creative layout").selectOption("freeform");
  await page.locator("#design-add-shape").click();
  await page.locator("#layer-shape").selectOption("none");
  await page.locator("#layer-color").fill("#ff0000");
  await expect(page.locator("#design-layer-count")).toHaveText("1 / 24");
  await expect.poll(()=>page.locator("#scene").evaluate(c=>Array.from(c.getContext("2d").getImageData(200,250,1,1).data))).toEqual([255,0,0,255]);
  await page.locator("#design-add-text").click();
  await page.locator("#layer-text").fill("Pixel Shroom design");
  await page.locator("#layer-text").press("Tab");
  await expect(page.locator("#design-layer-count")).toHaveText("2 / 24");
  await page.locator("#layer-duplicate").click();
  await expect(page.locator("#design-layer-count")).toHaveText("3 / 24");
  await page.locator("#design-undo").click();
  await expect(page.locator("#design-layer-count")).toHaveText("2 / 24");
  await page.locator("#design-redo").click();
  await expect(page.locator("#design-layer-count")).toHaveText("3 / 24");
  const [download]=await Promise.all([page.waitForEvent("download"),page.getByRole("button",{name:"Save project",exact:true}).click()]);
  const {readFile}=await import("node:fs/promises");
  const data=JSON.parse(await readFile(await download.path(),"utf8"));
  expect(data.layout).toBe("freeform");
  expect(data.layers).toHaveLength(3);
  expect(data.layers[0].color).toBe("#ff0000");
  expect(data.layers[1].text).toBe("Pixel Shroom design");
  await page.reload();
  await page.locator("#projectFile").setInputFiles({name:"layer-project.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(data))});
  await expect(page.locator("#design-layer-count")).toHaveText("3 / 24");
  await page.route("**/api/ad-studio/social/config",route=>route.fulfill({json:{configured:true,platforms:[]}}));
  await page.getByRole("button",{name:"Publish to social"}).click();
  await expect(page.locator("#serviceNotice")).toContainText("Buffer connected");
  expect(errors).toEqual([]);
});
