import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("identity section, artist story and verification FAQ stay connected", async ({
  page,
  request,
}) => {
  test.slow(); // Multi-page accessibility scan plus verification navigation.
  await page.goto("/");
  const order = await page
    .locator("main > section[id]")
    .evaluateAll((nodes) => nodes.map((node) => node.id));
  expect(order.indexOf("art-identity")).toBe(order.indexOf("shop-paths") + 1);
  await page.locator("#art-identity a").click();
  await expect(page).toHaveURL(/\/about.html$/);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("main")).toContainText("Why I Created Pixel Shroom Studio");
  await expect(page.locator("link[rel=canonical]")).toHaveAttribute(
    "href",
    "https://www.pixelshroomstudio.com/about.html",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
  expect((await request.get("/about", { maxRedirects: 0 })).status()).toBe(301);
  await page.goto("/faq.html");
  await page.getByText("How do I verify my numbered edition?", { exact: true }).click();
  await expect(page.locator("details[open]")).toContainText("SHA-256");
  await expect(page.locator("details[open]")).toContainText("exclusivity");
  const schema = await page
    .locator('script[type="application/ld+json"]')
    .evaluate((node) => JSON.parse(node.textContent));
  expect(
    schema["@graph"]
      .find((node) => node["@type"] === "FAQPage")
      .mainEntity.find((question) => question.name === "How do I verify my numbered edition?")
      .acceptedAnswer.text,
  ).toContain("SHA-256");
  await page.goto("/genre.html?genre=fantasy");
  await expect(page.locator(".artwork-provenance")).toHaveCount(6);
  await expect(page.locator("[data-provider=stripe]")).toHaveCount(6);
});
