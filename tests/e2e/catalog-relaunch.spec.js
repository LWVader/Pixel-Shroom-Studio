import { test, expect } from "@playwright/test";

async function openReset(page, { missing = false } = {}) {
  await page.route("https://esm.sh/@supabase/supabase-js@2.57.4", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `
        window.resetCalls = [];
        export function createClient() {
          return {
            auth: { getUser: async () => ({ data: { user: { id: 'owner' } } }), signOut: async () => {} },
            from: () => {
              const q = { select: () => q, is: () => q, eq: () => q, order: () => q, limit: () => q,
                maybeSingle: async () => ({ data: { user_id: 'owner' } }),
                then: done => done({ data: [] }) };
              return q;
            },
            rpc: async (name, body) => {
              window.resetCalls.push({ name, body });
              if (${missing}) return { error: { code: 'PGRST202', message: 'Function missing' } };
              return { data: { artworks: 2, orders: 1, gelato_orders: 1 } };
            },
          };
        }`,
    }),
  );
  await page.route("http://127.0.0.1:4179/**", (route) => route.abort());
  await page.goto("/admin.html#images-view");
  await page.getByText("Reset test storefront", { exact: true }).click();
}

test("full reset shows test order counts and requires the exact confirmation", async ({ page }) => {
  await openReset(page);
  await page.getByRole("button", { name: "Preview test reset" }).click();
  await expect(page.locator("#storefront-reset-counts")).toContainText("gelato orders: 1");
  const apply = page.getByRole("button", { name: "Permanently clear test data" });
  page.once("dialog", (dialog) => dialog.accept("RESET"));
  await apply.click();
  expect(await page.evaluate(() => window.resetCalls)).toEqual([
    { name: "preview_storefront_reset" },
  ]);
  page.once("dialog", (dialog) => dialog.accept("RESET TEST STOREFRONT"));
  await apply.click();
  await expect(page.locator("#storefront-reset-status")).toContainText("Test storefront cleared");
  expect(await page.evaluate(() => window.resetCalls)).toEqual([
    { name: "preview_storefront_reset" },
    {
      name: "reset_test_storefront",
      body: {
        expected_counts: { artworks: 2, orders: 1, gelato_orders: 1 },
        confirmation: "RESET TEST STOREFRONT",
      },
    },
  ]);
});

test("missing reset RPC explains the migration required to install it", async ({ page }) => {
  await openReset(page, { missing: true });
  await page.getByRole("button", { name: "Preview test reset" }).click();
  await expect(page.locator("#storefront-reset-status")).toContainText("supabase db push");
  await expect(page.getByRole("button", { name: "Permanently clear test data" })).toBeHidden();
});
