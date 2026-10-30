import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
it("gates canvas availability on complete mappings and exposes no secret when reporting payment mode", () => {
  expect(
    execFileSync(process.execPath, ["tests/forge-availability.cjs"], { encoding: "utf8" }),
  ).toContain("PASS");
});
