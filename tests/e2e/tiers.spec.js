import { test, expect } from "@playwright/test";
const edition = {
  artworkId: 1,
  enabled: true,
  maxSupply: 500,
  totalMinted: 0,
  reserved: 0,
  prismaticsRemaining: 5,
  silverCap: 100,
  goldCap: 50,
  emeraldCap: 30,
  sapphireCap: 15,
  prismaticCap: 5,
  rulesVersion: 2,
  dropRates: { Standard: 60, Silver: 20, Gold: 10, Emerald: 6, Sapphire: 3, Prismatic: 1 },
  price: 15,
};
test("six-tier odds disclose every rarity and marketplace filters submit both new gems", async ({
  page,
}) => {
  await page.route("**/rest/v1/rpc/foil_catalog", (route) => route.fulfill({ json: [edition] }));
  await page.goto("/genre.html?genre=portrait");
  const card = page.locator('[data-artwork-id="1"]');
  await card.getByText("Foil edition: odds and delivery").click();
  await expect(card).toContainText("Emerald 6%");
  await expect(card).toContainText("Sapphire 3%");
  await expect(card).toContainText("Standard 60%");
  await page.route("https://esm.sh/@supabase/supabase-js@2.57.4", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: "export function createClient(){return {auth:{getSession:async()=>({data:{session:null}})}}}",
    }),
  );
  let selected;
  await page.route("**/functions/v1/market-api", (route) => {
    selected = route.request().postDataJSON().tier;
    return route.fulfill({ json: { enabled: true, items: [], hasMore: false } });
  });
  await page.goto("/market.html");
  for (const tier of ["Emerald", "Sapphire"]) {
    await page.locator('[name="tier"]').selectOption(tier);
    await page.getByRole("button", { name: "Filter listings" }).click();
    await expect.poll(() => selected).toBe(tier);
  }
});
test("admin preserves locked legacy caps and restores new six-tier defaults", async ({ page }) => {
  const item = {
    id: 1,
    title: "Locked legacy",
    artist: "LWVader",
    category: "Fantasy",
    serial_number: "LWV-0000000001",
    price: 15,
    status: "published",
    display_width: 512,
    display_height: 512,
    preview_url: "/assets/art-fantasy.png",
    original_path: "private/master.png",
  };
  const locked = {
    enabled: true,
    maxSupply: 500,
    silverCap: 100,
    goldCap: 45,
    emeraldCap: 0,
    sapphireCap: 0,
    prismaticCap: 5,
    rulesVersion: 1,
    dropRates: { Standard: 70, Silver: 20, Gold: 9, Prismatic: 1 },
    locked: true,
  };
  await page.route("https://esm.sh/@supabase/supabase-js@2.57.4", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `export function createClient(){return {auth:{getUser:async()=>({data:{user:{id:'admin-fixture'}}}),signOut:async()=>{}},from:table=>{const q={select:()=>q,is:()=>q,eq:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>({data:{user_id:'admin-fixture'}}),then:done=>done({data:table==='artworks'?[${JSON.stringify(item)}]:[]})};return q;},rpc:async()=>({data:${JSON.stringify(locked)}})}}`,
    }),
  );
  await page.route("http://127.0.0.1:4179/**", (route) => route.abort());
  await page.goto("/admin.html#images-view");
  await page.locator('[data-edit="1"]').click();
  await expect(page.locator('[name="foilEmerald"]')).toHaveValue("0");
  await expect(page.locator('[name="foilSapphire"]')).toHaveJSProperty("readOnly", true);
  await expect(page.locator("#foil-odds-description")).toContainText("Standard 70%");
  await page.locator("#cancel-edit").click();
  await expect(page.locator('[name="foilEmerald"]')).toHaveValue("30");
  await expect(page.locator('[name="foilSapphire"]')).toHaveValue("15");
  await expect(page.locator('[name="foilSapphire"]')).toHaveJSProperty("readOnly", false);
  await expect(page.locator("#foil-odds-description")).toContainText("Emerald 6%");
});
