import { test, expect } from "@playwright/test";
test("catalog reset runs only after the owner confirms and clears current images", async ({
  page,
}) => {
  await page.route("https://esm.sh/@supabase/supabase-js@2.57.4", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `let retired=false;window.resetRequests=[];export function createClient(){return {auth:{getUser:async()=>({data:{user:{id:'owner'}}}),signOut:async()=>{}},from:table=>{const q={select:()=>q,is:()=>q,eq:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>({data:{user_id:'owner'}}),then:done=>done({data:table==='artworks'&&!retired?[{id:1,title:'Prior artwork',artist:'LWVader',category:'Fantasy',serial_number:'LWV-0000000001',price:15,status:'published',display_width:512,display_height:512,preview_url:'/assets/art-fantasy.png',original_path:'private/source.png'}]:[]})};return q},rpc:async(name,body)=>{window.resetRequests.push({name,body});if(name==='archive_catalog_for_relaunch'){retired=true;return {data:{archived:1,runId:'fixture'}}}return {data:{}}}}}`,
    }),
  );
  await page.route("http://127.0.0.1:4179/**", (route) => route.abort());
  await page.goto("/admin.html#images-view");
  await expect(page.locator("#admin-catalog")).toContainText("Prior artwork");
  expect(await page.evaluate(() => window.resetRequests)).toEqual([]);
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.locator("#archive-catalog").click();
  expect(await page.evaluate(() => window.resetRequests)).toEqual([]);
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#archive-catalog").click();
  await expect(page.locator("#catalog-relaunch-status")).toContainText(
    "1 artwork listings removed",
  );
  await expect(page.locator("#admin-catalog .admin-item")).toHaveCount(0);
  expect(await page.evaluate(() => window.resetRequests)).toEqual([
    { name: "archive_catalog_for_relaunch", body: { expected_count: 1 } },
  ]);
});

test("permanent reset previews archived serials and submits only reviewed unlinked IDs", async ({
  page,
}) => {
  await page.route("https://esm.sh/@supabase/supabase-js@2.57.4", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `window.rebuildCalls=[];export function createClient(){return {auth:{getUser:async()=>({data:{user:{id:'owner'}}}),signOut:async()=>{}},from:()=>{const q={select:()=>q,is:()=>q,eq:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>({data:{user_id:'owner'}}),then:done=>done({data:[]})};return q},rpc:async(name,body)=>{window.rebuildCalls.push({name,body});return {data:name==='preview_artwork_rebuild'?[{id:1,serial:'LWV-0000000001',title:'Archived',protected:false},{id:2,serial:'LWV-0000000002',title:'Purchased',protected:true}]:1}}}}`,
    }),
  );
  await page.route("http://127.0.0.1:4179/**", (route) => route.abort());
  await page.goto("/admin.html#images-view");
  await page.getByText("Permanently reset old artwork records", { exact: true }).click();
  await page.locator("#preview-artwork-rebuild").click();
  await expect(page.locator("#artwork-rebuild-preview")).toContainText(
    "1 protected by transaction history",
  );
  page.once("dialog", (dialog) => dialog.accept("DELETE ARTWORK"));
  await page.locator("#apply-artwork-rebuild").click();
  await expect(page.locator("#artwork-rebuild-preview")).toContainText(
    "1 artwork records permanently deleted",
  );
  expect(await page.evaluate(() => window.rebuildCalls)).toEqual([
    { name: "preview_artwork_rebuild" },
    { name: "delete_unlinked_artworks_for_rebuild", body: { expected_ids: [1] } },
  ]);
});
