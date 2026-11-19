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
  await expect(page.locator(".work-card:visible")).toHaveCount(5);
  await page.getByRole("button", {name: "Indie games", exact: true}).click();
  await expect(page.locator(".work-card:visible")).toHaveCount(1);
  await page.getByRole("button", {name: /Mossbyte Games/}).click();
  await expect(page.getByRole("dialog", {name: "Mossbyte Games"})).toBeVisible();
  await expect(page.locator("#case-palette li")).toHaveCount(4);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", {name: "All work", exact: true}).click();
  await expect(page.locator(".work-card:visible")).toHaveCount(5);
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
