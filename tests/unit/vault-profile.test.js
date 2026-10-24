import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
it("protects shipping profiles from anonymous access and cross-account reads/writes", () => {
  expect(
    execFileSync(process.execPath, ["tests/vault-profile-database.mjs"], { encoding: "utf8" }),
  ).toContain("PASS");
});
