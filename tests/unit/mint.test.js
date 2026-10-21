import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, webcrypto } from "node:crypto";
import sharp from "sharp";
import { renderMint, sha256, verifyReceipt } from "../../mint-worker/render.mjs";
import { safeMintImage } from "../../public/mint-core.js";
it("enforces SQL mint caps, allocation, replay and private-ledger boundaries", () => {
  expect(
    execFileSync(process.execPath, ["tests/mint-database.mjs"], { encoding: "utf8" }),
  ).toContain("PASS");
});
async function fixture() {
  const bytes = await sharp({
    create: { width: 128, height: 96, channels: 3, background: "#12638a" },
  })
    .png()
    .toBuffer();
  const key = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const payload = {
    version: 1,
    serialNumber: "LWV-0000000001",
    creator: "LWVader",
    sha256: sha256(bytes),
  };
  const record = {
    payload_version: 1,
    serial_number: payload.serialNumber,
    creator: payload.creator,
    sha256: payload.sha256,
    public_key_jwk: await webcrypto.subtle.exportKey("jwk", key.publicKey),
    signature: Buffer.from(
      await webcrypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        key.privateKey,
        new TextEncoder().encode(JSON.stringify(payload)),
      ),
    ).toString("base64"),
  };
  return {
    bytes,
    listing: {
      max_supply: 500,
      master_serial: payload.serialNumber,
      master_sha256: payload.sha256,
      master_record: record,
    },
  };
}
it("renders six distinct signed tiers and preserves final-byte identity", async () => {
  const { bytes, listing } = await fixture();
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const hashes = [];
  for (const [i, tier] of [
    "Standard",
    "Silver",
    "Gold",
    "Emerald",
    "Sapphire",
    "Prismatic",
  ].entries()) {
    const job = { listing, mint: { id: `fixture-${i}`, tier, mint_number: i + 1, listing_id: 1 } };
    const output = await renderMint(bytes, job, privateKey, "trusted-test-key");
    expect(verifyReceipt(output.bytes, output.manifest, publicKey)).toBe(true);
    expect(output.manifest.payload.masterSha256).toBe(sha256(bytes));
    expect(output.width).toBe(128);
    expect(output.height).toBe(96);
    const metadata = await sharp(output.bytes).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.xmp.toString()).toContain(tier);
    const changed = { ...output.manifest, payload: { ...output.manifest.payload, tier: "Fake" } };
    expect(verifyReceipt(output.bytes, changed, publicKey)).toBe(false);
    expect(verifyReceipt(Buffer.from("changed"), output.manifest, publicKey)).toBe(false);
    hashes.push(sha256(output.bytes));
  }
  expect(new Set(hashes).size).toBe(6);
});
it("rejects replaced masters and untrusted delivery URLs", async () => {
  const { bytes, listing } = await fixture();
  const { privateKey } = generateKeyPairSync("ed25519");
  await expect(
    renderMint(
      Buffer.concat([bytes, Buffer.from("tamper")]),
      { listing, mint: { tier: "Gold", mint_number: 1 } },
      privateKey,
      "key",
    ),
  ).rejects.toThrow("Master identity");
  expect(() =>
    safeMintImage(
      "https://evil.example/storage/v1/object/sign/minted/a",
      "https://project.supabase.co",
    ),
  ).toThrow();
  expect(() =>
    safeMintImage(
      "https://project.supabase.co/storage/v1/object/sign/originals/a",
      "https://project.supabase.co",
    ),
  ).toThrow();
  expect(
    safeMintImage(
      "https://project.supabase.co/storage/v1/object/sign/minted/a?token=x",
      "https://project.supabase.co",
    ),
  ).toContain("/minted/");
});
it("isolates owner collections and order-token delivery", () => {
  expect(execFileSync(process.execPath, ["tests/mint-access.cjs"], { encoding: "utf8" })).toContain(
    "PASS",
  );
});
it("processes a private queued master into a signed lease-fenced artifact", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { bytes, listing } = await fixture();
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pixel-mint-worker-"));
  try {
    const key = path.join(dir, "private.pem"),
      pub = path.join(dir, "public.pem"),
      file = path.join(dir, "fixture.json");
    fs.writeFileSync(key, privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
    fs.writeFileSync(pub, publicKey.export({ format: "pem", type: "spki" }));
    fs.writeFileSync(
      file,
      JSON.stringify({
        master: bytes.toString("base64"),
        job: {
          listing: { ...listing, master_path: "fixtures/master.png" },
          mint: {
            id: "11111111-1111-4111-8111-111111111111",
            owner_id: "22222222-2222-4222-8222-222222222222",
            listing_id: 1,
            mint_number: 42,
            tier: "Gold",
            lease_id: "33333333-3333-4333-8333-333333333333",
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
            MINT_TEST_PUBLIC_KEY: pub,
            MINT_TEST_FIXTURE: file,
            STRIPE_SECRET_KEY: "",
          },
        },
      ),
    ).toContain("PASS private worker pipeline");
    const batch = execFileSync(
      process.execPath,
      ["--import", "./tests/mint-worker-fixture.mjs", "mint-worker/worker.mjs", "--batch"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          SUPABASE_URL: "https://mint-fixture.invalid",
          SUPABASE_SERVICE_ROLE_KEY: "fixture-private-service",
          MINT_SIGNING_KEY_FILE: "missing.pem",
          MINT_SIGNING_KEY_B64: Buffer.from(
            privateKey.export({ format: "pem", type: "pkcs8" }),
          ).toString("base64"),
          MINT_TEST_PUBLIC_KEY: pub,
          MINT_TEST_FIXTURE: file,
          STRIPE_SECRET_KEY: "",
        },
      },
    );
    expect(batch).toContain("processed: 1");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it("renders repeatable holographic Prismatics without inverting the source palette", async () => {
  const { bytes, listing } = await fixture();
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const job = {
    listing,
    mint: { id: "repeatable-holo", tier: "Prismatic", mint_number: 42, listing_id: 1 },
  };
  const first = await renderMint(bytes, job, privateKey, "trusted-test-key");
  const second = await renderMint(bytes, job, privateKey, "trusted-test-key");
  expect(sha256(first.bytes)).toBe(sha256(second.bytes));
  expect(first.manifest.payload.pipelineVersion).toBe("foil-v2-prismatic-holo");
  expect(verifyReceipt(first.bytes, first.manifest, publicKey)).toBe(true);
  const stats = await sharp(first.bytes)
    .extract({ left: 32, top: 24, width: 64, height: 48 })
    .stats();
  // The blue test master must remain blue-led, rather than becoming a negative.
  expect(stats.channels[2].mean).toBeGreaterThan(stats.channels[0].mean);
  expect(stats.channels[0].mean).toBeLessThan(160);
});

it("fits the reusable Prismatic frame to portrait, landscape and small assets", async () => {
  const { prismaticLayers } = await import("../../mint-worker/prismatic.mjs");
  for (const [width, height] of [
    [240, 360],
    [360, 240],
    [32, 32],
  ]) {
    const image = await sharp({ create: { width, height, channels: 3, background: "#243e62" } })
      .composite(prismaticLayers(width, height, "aspect-test"))
      .webp()
      .toBuffer();
    const metadata = await sharp(image).metadata();
    expect([metadata.width, metadata.height]).toEqual([width, height]);
  }
  expect(() => prismaticLayers(0, 100, "bad")).toThrow();
});

it("preserves legacy drops and enforces six-tier odds, caps and reservation locks", () => {
  expect(
    execFileSync(process.execPath, ["tests/six-tier-database.mjs"], { encoding: "utf8" }),
  ).toContain("PASS");
});
it("fits metallic and gemstone finishes to every aspect ratio without altering Standard", async () => {
  const { finishLayers } = await import("../../mint-worker/finishes.mjs");
  for (const tier of ["Silver", "Gold", "Emerald", "Sapphire"])
    for (const [width, height] of [
      [96, 144],
      [144, 96],
      [32, 32],
    ]) {
      const layers = finishLayers(width, height, tier, "stable-finish");
      const a = await sharp({ create: { width, height, channels: 3, background: "#205b74" } })
        .composite(layers)
        .webp()
        .toBuffer();
      const b = await sharp({ create: { width, height, channels: 3, background: "#205b74" } })
        .composite(finishLayers(width, height, tier, "stable-finish"))
        .webp()
        .toBuffer();
      expect(sha256(a)).toBe(sha256(b));
      const metadata = await sharp(a).metadata();
      expect([metadata.width, metadata.height]).toEqual([width, height]);
    }
});
