// Subprocess-only private service fixture: no network traffic leaves this test.
import fs from "node:fs";
import assert from "node:assert/strict";
import { verifyReceipt } from "../mint-worker/render.mjs";
const fixture = JSON.parse(fs.readFileSync(process.env.MINT_TEST_FIXTURE, "utf8"));
let output,
  claimed = false,
  finished = false;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  assert.equal(url.origin, "https://mint-fixture.invalid");
  assert.equal(init.headers.Authorization, "Bearer fixture-private-service");
  if (url.pathname === "/rest/v1/foil_keys") return new Response(null, { status: 201 });
  if (url.pathname === "/rest/v1/rpc/claim_foil_copy_batch") return Response.json(null);
  if (url.pathname === "/rest/v1/rpc/claim_market_preview") return Response.json(null);
  if (url.pathname === "/rest/v1/rpc/claim_foil_job") {
    if (claimed) return Response.json(null);
    claimed = true;
    return Response.json(fixture.job);
  }
  if (url.pathname.startsWith("/storage/v1/object/authenticated/originals/"))
    return new Response(Buffer.from(fixture.master, "base64"));
  if (url.pathname.startsWith("/storage/v1/object/minted/")) {
    output = Buffer.from(init.body);
    assert.equal(init.headers["x-upsert"], "false");
    assert.equal(init.headers["Content-Type"], fixture.job.tier_asset?.mime_type || "image/webp");
    if (fixture.job.mint.asset_mode === "uploaded")
      assert.deepEqual(output, Buffer.from(fixture.master, "base64"));
    return new Response("{}", { status: 201 });
  }
  if (url.pathname === "/rest/v1/rpc/finish_foil_job") {
    const commit = JSON.parse(init.body);
    assert.equal(commit.lease, fixture.job.mint.lease_id);
    assert.equal(
      commit.artifact,
      `${fixture.job.mint.owner_id}/${fixture.job.mint.id}/${fixture.job.mint.lease_id}.${{ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[fixture.job.tier_asset?.mime_type || "image/webp"]}`,
    );
    assert.equal(
      verifyReceipt(output, commit.receipt, fs.readFileSync(process.env.MINT_TEST_PUBLIC_KEY)),
      true,
    );
    finished = true;
    console.log("PASS private worker pipeline");
    return Response.json(true);
  }
  throw new Error("Unexpected private-service request: " + url.pathname);
};
process.on("beforeExit", () => {
  if (!finished) {
    console.error("Worker did not commit");
    process.exitCode = 1;
  }
});
