import { test, expect } from "@playwright/test";
test("contact successful submission and error recovery use fixtures only", async ({ page }) => {
  let fail = false;
  await page.route("**/functions/v1/submit-message", (r) =>
    r.fulfill({
      status: fail ? 500 : 200,
      json: fail ? { error: "Fixture failure" } : { ok: true },
    }),
  );
  await page.goto("/contact.html");
  async function fill() {
    await page.locator("[name=name]").fill("Test Person");
    await page.locator("[name=email]").fill("test@example.invalid");
    await page.locator("[name=subject]").fill("Test inquiry");
    await page.locator("[name=message]").fill("An isolated test message.");
  }
  await fill();
  await page.locator("#contact-form button").click();
  await expect(page.locator("#contact-message")).toContainText("was sent");
  fail = true;
  await fill();
  await page.locator("#contact-form button").click();
  await expect(page.locator("#contact-message")).toContainText("Fixture failure");
  await expect(page.locator("#contact-form button")).toBeEnabled();
});
test("incomplete checkout return never offers a download", async ({ page }) => {
  await page.route("**/esm.sh/**", (r) =>
    r.fulfill({ contentType: "text/javascript", body: "export const createClient=()=>({});" }),
  );
  await page.goto("/checkout-success.html");
  await expect(page.locator("#download-link")).toBeHidden();
  await expect(page.locator("#checkout-message")).not.toBeEmpty();
});
