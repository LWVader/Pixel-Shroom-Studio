import { test, expect } from "@playwright/test";
test("Vault signup, password login, private shipping save and sign-out", async ({ page }) => {
  await page.route("https://esm.sh/@supabase/supabase-js@2.57.4", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
 const listeners=[];let session=null,recipient=null;
 const user={id:'11111111-1111-4111-8111-111111111111',email:'collector@example.com'};
 export function createClient(){return {
 auth:{getSession:async()=>({data:{session}}),getUser:async()=>({data:{user:session?.user}}),onAuthStateChange:fn=>{listeners.push(fn);return {data:{subscription:{unsubscribe(){}}}}},
 signUp:async(args)=>{window.signup=args;return {data:{session:null},error:null}},
 signInWithPassword:async(args)=>{window.signin=args;session={user,access_token:'fixture'};listeners.forEach(fn=>fn('SIGNED_IN',session));return {data:{session},error:null}},
 signOut:async()=>{session=null;listeners.forEach(fn=>fn('SIGNED_OUT',null));return {error:null}},
 resetPasswordForEmail:async(email)=>{window.resetEmail=email;return {error:null}},updateUser:async()=>({error:null})},
 rpc:async()=>({data:[],error:null}),from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:recipient?{recipient}:null,error:null}),upsert:async(row)=>{recipient=row.recipient;window.savedProfile=row;return {error:null}},delete(){return {eq:async()=>{recipient=null;return {error:null}}}}})};}
 `,
    }),
  );
  await page.route("**/functions/v1/**", (route) =>
    route.fulfill({ json: { items: [], hasMore: false, products: [], enabled: false } }),
  );
  await page.goto("/collection.html?tab=account");
  const auth = page.locator("#collection-auth");
  await auth.locator("[name=email]").fill("collector@example.com");
  await auth.locator("[name=password]").fill("long-test-password");
  await auth.locator("[name=confirmation]").fill("long-test-password");
  await auth.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.locator("#collection-status")).toContainText("Check your email");
  expect(await page.evaluate(() => window.signup.options.emailRedirectTo)).toContain(
    "/collection.html?tab=account",
  );
  await auth.locator("[name=email]").fill("collector@example.com");
  await auth.locator("[name=password]").fill("long-test-password");
  await auth.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#account-email")).toHaveText("collector@example.com");
  const shipping = page.locator("#vault-shipping-form");
  for (const [key, value] of Object.entries({
    firstName: "Test",
    lastName: "Collector",
    addressLine1: "123 Main St",
    city: "Boston",
    state: "ma",
    postCode: "02108",
  }))
    await shipping.locator("[name=" + key + "]").fill(value);
  await shipping.getByRole("button", { name: "Save delivery address" }).click();
  await expect(page.locator("#account-status")).toContainText("Delivery address saved");
  expect(await page.evaluate(() => window.savedProfile.recipient.state)).toBe("MA");
  expect(await page.evaluate(() => window.savedProfile.user_id)).toBe(
    "11111111-1111-4111-8111-111111111111",
  );
  await page.getByRole("button", { name: "Change password by email" }).click();
  await expect(page.locator("#account-status")).toContainText("Password-reset email requested");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.locator("#account-signed-in")).toBeHidden();
  await expect(shipping.locator("[name=addressLine1]")).toHaveValue("");
  await expect(auth).toBeVisible();
});

test("canvas delivery uses saved account address and leaves consent unchecked", async ({
  page,
}) => {
  await page.route("https://esm.sh/@supabase/supabase-js@2.57.4", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export function createClient(){return {auth:{getSession:async()=>({data:{session:{access_token:'fixture',user:{id:'owner',email:'collector@example.com'}}}}),onAuthStateChange:()=>({})},from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:{recipient:{firstName:'Test',lastName:'Collector',addressLine1:'123 Main St',city:'Boston',state:'MA',postCode:'02108',country:'US'}}})}),rpc:async()=>({data:[]})};}`,
    }),
  );
  await page.route("**/functions/v1/print-api", (route) =>
    route.fulfill({
      json: {
        products: [
          {
            id: "product",
            title: "Canvas",
            kind: "canvas",
            variant_label: "16 × 16 thick",
            preview_url: "/assets/logo.webp",
            retail_cents: 4900,
          },
        ],
        enabled: true,
        testMode: true,
        countries: ["US"],
      },
    }),
  );
  await page.goto("/canvases.html");
  await page.getByRole("button", { name: "Choose delivery" }).click();
  await expect(page.locator("#print-quote-form [name=addressLine1]")).toHaveValue("123 Main St");
  await expect(page.locator("#print-quote-form [name=postCode]")).toHaveValue("02108");
  await expect(page.locator("#print-quote-form [name=consent]")).not.toBeChecked();
});
