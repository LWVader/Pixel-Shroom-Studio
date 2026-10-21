import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import sharp from "sharp";
import { prepareCopyImage } from "../../mint-worker/copy-identity.mjs";
import { renderMint, sha256, verifyReceipt } from "../../mint-worker/render.mjs";
it("enforces prepared stock, paid assignment, replay protection and six-image publishing", () => {
  expect(
    execFileSync(process.execPath, ["tests/copy-inventory-database.mjs"], { encoding: "utf8" }),
  ).toContain("PASS");
});
for (const format of ["png", "jpeg", "webp"])
  it(`prepares unique ${format} hashes without changing pixels and releases the assigned hash`, async () => {
    const bytes = await sharp({
      create: { width: 48, height: 32, channels: 3, background: "#195da0" },
    })
      [format]()
      .toBuffer();
    const mime = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" }[format];
    const copies = [1, 2, 3].map((n) => ({
      id: `copy-${n}`,
      listing_id: 1,
      tier: "Gold",
      copy_number: n,
      source_sha256: sha256(bytes),
      mint_id: `mint-${n}`,
    }));
    const outputs = copies.map((copy) => prepareCopyImage(bytes, mime, copy));
    expect(new Set(outputs.map(sha256)).size).toBe(3);
    const pixels = await sharp(bytes).raw().toBuffer();
    for (const [i, output] of outputs.entries()) {
      expect((await sharp(output).raw().toBuffer()).equals(pixels)).toBe(true);
      expect(prepareCopyImage(bytes, mime, copies[i]).equals(output)).toBe(true);
    }
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const copy = { ...copies[0], sha256: sha256(outputs[0]) };
    const job = {
      listing: { max_supply: 500, master_serial: "LWV-0000000001", master_sha256: "a".repeat(64) },
      mint: {
        id: "mint-1",
        copy_id: copy.id,
        listing_id: 1,
        tier: "Gold",
        mint_number: 42,
        asset_mode: "inventory",
      },
      tier_asset: {
        listing_id: 1,
        tier: "Gold",
        sha256: sha256(bytes),
        mime_type: mime,
        width: 48,
        height: 32,
      },
      copy,
    };
    const delivered = await renderMint(bytes, job, privateKey, "fixture");
    expect(delivered.bytes.equals(outputs[0])).toBe(true);
    expect(delivered.manifest.payload.copyId).toBe(copy.id);
    expect(verifyReceipt(delivered.bytes, delivered.manifest, publicKey)).toBe(true);
    await expect(
      renderMint(
        bytes,
        { ...job, copy: { ...copy, sha256: "f".repeat(64) } },
        privateKey,
        "fixture",
      ),
    ).rejects.toThrow("Prepared copy hash mismatch");
  });
it("precomputes real copy hashes through the private worker before any purchase", async () => {
  const fs = await import("node:fs"),
    os = await import("node:os"),
    path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pixel-copy-prep-"));
  try {
    const bytes = await sharp({
      create: { width: 32, height: 24, channels: 3, background: "#246888" },
    })
      .png()
      .toBuffer();
    const { privateKey } = generateKeyPairSync("ed25519");
    const key = path.join(dir, "private.pem"),
      file = path.join(dir, "fixture.json");
    fs.writeFileSync(key, privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
    const copies = [1, 2, 3].map((n) => ({
      id: `copy-${n}`,
      listing_id: 1,
      tier: "Gold",
      copy_number: n,
      source_sha256: sha256(bytes),
      lease_id: "lease-fixture",
    }));
    fs.writeFileSync(
      file,
      JSON.stringify({
        source: bytes.toString("base64"),
        batch: {
          copies,
          source: {
            path: "foil-tiers/1/gold/source.png",
            sha256: sha256(bytes),
            mime_type: "image/png",
            width: 32,
            height: 24,
          },
        },
        hashes: Object.fromEntries(
          copies.map((c) => [c.id, sha256(prepareCopyImage(bytes, "image/png", c))]),
        ),
      }),
    );
    expect(
      execFileSync(
        process.execPath,
        ["--import", "./tests/copy-preparation-fixture.mjs", "mint-worker/worker.mjs", "--once"],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            SUPABASE_URL: "https://mint-fixture.invalid",
            SUPABASE_SERVICE_ROLE_KEY: "fixture-private-service",
            MINT_SIGNING_KEY_FILE: key,
            MINT_SIGNING_KEY_B64: "",
            COPY_TEST_FIXTURE: file,
            STRIPE_SECRET_KEY: "",
          },
        },
      ),
    ).toContain("PASS upfront worker copy hashing");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
