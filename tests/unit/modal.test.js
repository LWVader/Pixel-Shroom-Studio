import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
it("wakes Modal only after paid foil fulfillment and keeps payment committed on wake failure", () => {
  expect(
    execFileSync(process.execPath, ["tests/modal-webhook.cjs"], { encoding: "utf8" }),
  ).toContain("PASS");
});
