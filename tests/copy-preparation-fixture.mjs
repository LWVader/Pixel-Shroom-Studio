import fs from "node:fs";
import assert from "node:assert/strict";
const fixture = JSON.parse(fs.readFileSync(process.env.COPY_TEST_FIXTURE, "utf8"));
let finished = 0;
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(String(input));
  assert.equal(u.origin, "https://mint-fixture.invalid");
  if (u.pathname === "/rest/v1/foil_keys") return new Response(null, { status: 201 });
  if (u.pathname === "/rest/v1/rpc/claim_foil_job") return Response.json(null);
  if (u.pathname === "/rest/v1/rpc/claim_foil_copy_batch") return Response.json(fixture.batch);
  if (u.pathname.startsWith("/storage/v1/object/authenticated/originals/"))
    return new Response(Buffer.from(fixture.source, "base64"));
  if (u.pathname === "/rest/v1/rpc/finish_foil_copy") {
    const body = JSON.parse(init.body);
    assert.equal(body.digest, fixture.hashes[body.target]);
    finished++;
    return Response.json(true);
  }
  throw Error("Unexpected private request: " + u.pathname);
};
process.on("beforeExit", () => {
  assert.equal(finished, fixture.batch.copies.length);
  console.log("PASS upfront worker copy hashing");
});
