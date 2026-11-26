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
