import {expect, test} from "@playwright/test";

test("mobile homepage fits the viewport and the footer login opens", async ({page}) => {
  await page.goto("/");
  await expect(page.locator(".hero h1")).toBeVisible();
  await expect.poll(() => page.locator(".hero-background img").evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth)
  );
  await expect(page.locator("#landing")).toBeVisible();
  await expect(page.locator("#monthly")).toBeVisible();
  await expect(page.locator(".asset-examples img")).toHaveCount(10);
  await page.getByRole("link", {name: "Studio administrator sign-in"}).click();
  await expect(page.getByRole("heading", {name: "Administrator sign-in"})).toBeVisible();
  await expect(page.getByRole("button", {name: "Sign in", exact: true})).toBeEnabled();
});

test("AD Studio design layers fit a small viewport and can be edited without dragging", async ({page}) => {
  const {testPassword}=await import("../fixture.mjs");
  await page.setViewportSize({width:375,height:812});
  await page.goto("/admin.html");
  await page.getByLabel("Administrator password").fill(testPassword);
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await page.getByRole("link",{name:"Open AD Studio"}).click();
  await page.locator("#design-add-text").click();
  await page.locator("#layer-x").fill("20");
  await page.locator("#layer-x").press("Tab");
  await expect(page.locator("#layer-x")).toHaveValue("20");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(376);
  await page.setViewportSize({width:812,height:375});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(813);
});
