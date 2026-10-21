import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import sharp from "sharp";
import { renderMint, sha256, verifyReceipt } from "../../mint-worker/render.mjs";
import { FOIL_TIERS } from "../../public/mint-core.js";

it("requires all six private uploads, freezes purchased sources and commits the selected tier", () => {
  expect(
    execFileSync(process.execPath, ["tests/uploaded-tier-database.mjs"], { encoding: "utf8" }),
  ).toContain("PASS");
});
for (const format of ["png", "jpeg", "webp"])
  it(`delivers exact ${format} bytes for every tier with individual signed receipts`, async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    for (const [index, tier] of FOIL_TIERS.entries()) {
      const bytes = await sharp({
        create: {
          width: 48 + index,
          height: 32,
          channels: 3,
          background: { r: 25 + index * 20, g: 80, b: 130 },
        },
      })
        [format]()
        .toBuffer();
      const job = {
        listing: {
          max_supply: 500,
          master_serial: "LWV-0000000001",
          master_sha256: "a".repeat(64),
        },
        mint: { id: "mint-1", listing_id: 1, tier, mint_number: 1, asset_mode: "uploaded" },
        tier_asset: {
          listing_id: 1,
          tier,
          sha256: sha256(bytes),
          mime_type: { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" }[format],
          width: 48 + index,
          height: 32,
        },
      };
      const first = await renderMint(bytes, job, privateKey, "fixture-key");
      const second = await renderMint(
        bytes,
        { ...job, mint: { ...job.mint, id: "mint-2", mint_number: 2 } },
        privateKey,
        "fixture-key",
      );
      expect(first.bytes.equals(bytes)).toBe(true);
      expect(second.bytes.equals(bytes)).toBe(true);
      expect(first.manifest.payload.pipelineVersion).toBe("foil-v4-uploaded-copy");
      expect(first.manifest.signature).not.toBe(second.manifest.signature);
      expect(verifyReceipt(bytes, first.manifest, publicKey)).toBe(true);
      await expect(
        renderMint(Buffer.from("wrong"), job, privateKey, "fixture-key"),
      ).rejects.toThrow("identity mismatch");
      await expect(
        renderMint(
          bytes,
          { ...job, tier_asset: { ...job.tier_asset, tier: "Wrong" } },
          privateKey,
          "fixture-key",
        ),
      ).rejects.toThrow("identity mismatch");
    }
  });

it("copies the selected private upload through the actual worker without re-encoding", async () => {
  const fs = await import("node:fs"),
    os = await import("node:os"),
    path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pixel-uploaded-worker-"));
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  try {
    const key = path.join(dir, "private.pem"),
      pub = path.join(dir, "public.pem"),
      file = path.join(dir, "fixture.json");
    fs.writeFileSync(key, privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
    fs.writeFileSync(pub, publicKey.export({ format: "pem", type: "spki" }));
    for (const format of ["png", "jpeg", "webp"]) {
      const bytes = await sharp({
        create: { width: 48, height: 32, channels: 3, background: "#1b65ab" },
      })
        [format]()
        .toBuffer();
      fs.writeFileSync(
        file,
        JSON.stringify({
          master: bytes.toString("base64"),
          job: {
            listing: {
              max_supply: 500,
              master_serial: "LWV-0000000001",
              master_sha256: "a".repeat(64),
            },
            mint: {
              id: "11111111-1111-4111-8111-111111111111",
              owner_id: "22222222-2222-4222-8222-222222222222",
              listing_id: 1,
              tier: "Sapphire",
              mint_number: 42,
              lease_id: "33333333-3333-4333-8333-333333333333",
              asset_mode: "uploaded",
            },
            tier_asset: {
              listing_id: 1,
              tier: "Sapphire",
              path: `foil-tiers/1/sapphire/source.${format}`,
              sha256: sha256(bytes),
              mime_type: { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" }[format],
              width: 48,
              height: 32,
            },
          },
        }),
      );
      expect(
        execFileSync(
          process.execPath,
          ["--import", "./tests/mint-worker-fixture.mjs", "mint-worker/worker.mjs", "--once"],
          {
            encoding: "utf8",
            env: {
              ...process.env,
              SUPABASE_URL: "https://mint-fixture.invalid",
              SUPABASE_SERVICE_ROLE_KEY: "fixture-private-service",
              MINT_SIGNING_KEY_FILE: key,
              MINT_SIGNING_KEY_B64: "",
              MINT_TEST_PUBLIC_KEY: pub,
              MINT_TEST_FIXTURE: file,
              STRIPE_SECRET_KEY: "",
            },
          },
        ),
      ).toContain("PASS private worker pipeline");
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
