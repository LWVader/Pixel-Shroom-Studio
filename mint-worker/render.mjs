import { prepareCopyImage } from "./copy-identity.mjs";
import sharp from "sharp";
import { createHash, sign, verify, webcrypto } from "node:crypto";
import { canonicalMintPayload, FOIL_TIERS } from "../public/mint-core.js";
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function validateMaster(bytes, listing) {
  const record = listing.master_record;
  if (
    sha256(bytes) !== listing.master_sha256 ||
    record.sha256 !== listing.master_sha256 ||
    record.serial_number !== listing.master_serial ||
    record.payload_version !== 1
  )
    throw new Error("Master identity mismatch");
  const key = await webcrypto.subtle.importKey(
    "jwk",
    record.public_key_jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const payload = JSON.stringify({
    version: 1,
    serialNumber: record.serial_number,
    creator: record.creator,
    sha256: record.sha256,
  });
  if (
    !(await webcrypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      Buffer.from(record.signature, "base64"),
      new TextEncoder().encode(payload),
    ))
  )
    throw new Error("Invalid master signature");
}
export async function renderMint(bytes, job, privateKey, keyId) {
  const { mint, listing, tier_asset: source } = job;
  if (
    !FOIL_TIERS.includes(mint.tier) ||
    !Number.isInteger(mint.mint_number) ||
    mint.mint_number < 1 ||
    mint.mint_number > listing.max_supply
  )
    throw new Error("Invalid allocated mint");
  if (["uploaded", "inventory"].includes(mint.asset_mode)) {
    if (
      !source ||
      source.tier !== mint.tier ||
      Number(source.listing_id) !== Number(mint.listing_id) ||
      sha256(bytes) !== source.sha256
    )
      throw new Error("Uploaded tier identity mismatch");
    const image = sharp(bytes, { limitInputPixels: 100_000_000, animated: false });
    const metadata = await image.metadata();
    const mimeType = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" }[metadata.format];
    const swapped = [5, 6, 7, 8].includes(metadata.orientation);
    const width = swapped ? metadata.height : metadata.width;
    const height = swapped ? metadata.width : metadata.height;
    if (
      !mimeType ||
      mimeType !== source.mime_type ||
      (metadata.pages || 1) !== 1 ||
      width !== source.width ||
      height !== source.height
    )
      throw new Error("Uploaded tier format or dimensions mismatch");
    // Force a complete decode to reject truncated/corrupt inputs. Keep original bytes.
    await image.stats();
    let output = Buffer.from(bytes);
    if (mint.asset_mode === "inventory") {
      const copy = job.copy;
      if (
        !copy ||
        copy.id !== mint.copy_id ||
        copy.mint_id !== mint.id ||
        copy.tier !== mint.tier ||
        Number(copy.listing_id) !== Number(mint.listing_id) ||
        copy.source_sha256 !== source.sha256
      )
        throw new Error("Assigned copy identity mismatch");
      output = prepareCopyImage(bytes, mimeType, copy);
      if (sha256(output) !== copy.sha256) throw new Error("Prepared copy hash mismatch");
    }
    const payload = {
      version: 1,
      mintId: mint.id,
      listingId: String(mint.listing_id),
      masterSerial: listing.master_serial,
      masterSha256: listing.master_sha256,
      mintNumber: mint.mint_number,
      maxSupply: listing.max_supply,
      tier: mint.tier,
      width,
      height,
      mimeType,
      sha256: sha256(output),
      tierSourceSha256: source.sha256,
      keyId,
      ...(job.copy ? { copyId: job.copy.id, copyNumber: job.copy.copy_number } : {}),
      pipelineVersion:
        mint.asset_mode === "inventory" ? "foil-v5-prehashed-copy" : "foil-v4-uploaded-copy",
    };
    const signature = sign(null, Buffer.from(canonicalMintPayload(payload)), privateKey).toString(
      "base64",
    );
    return {
      bytes: output,
      manifest: { algorithm: "Ed25519", payload, signature },
      width,
      height,
    };
  }
  if (mint.asset_mode && mint.asset_mode !== "legacy") throw new Error("Unknown delivery mode");
  // Only jobs reserved before the uploaded-image migration use the legacy renderer.
  await validateMaster(bytes, listing);
  // Decode/re-encode deliberately: master C2PA metadata cannot describe a derivative.
  let image = sharp(bytes, { limitInputPixels: 100_000_000, animated: false })
    .rotate()
    .resize({ width: 16000, height: 16000, fit: "inside", withoutEnlargement: true });
  const base = await image.png().toBuffer({ resolveWithObject: true });
  const { width, height } = base.info;
  // Generated treatments are loaded only for reservations made before migration 5.
  let overlay = [];
  if (mint.tier === "Prismatic") {
    const { prismaticLayers } = await import("./prismatic.mjs");
    overlay = prismaticLayers(width, height, `${listing.master_serial}|${mint.id}`);
  } else if (mint.tier !== "Standard") {
    const { finishLayers } = await import("./finishes.mjs");
    overlay = finishLayers(width, height, mint.tier, `${listing.master_serial}|${mint.id}`);
  }
  // Identity metadata is embedded BEFORE hashing. The detached signed receipt
  // then authenticates the final bytes, avoiding a self-referential file hash.
  const identity = `${mint.id}|${listing.master_serial}|${mint.mint_number}/${listing.max_supply}|${mint.tier}`;
  const output = await sharp(base.data)
    .composite(overlay)
    .withXmp(
      `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" dc:identifier="${identity}"/></rdf:RDF></x:xmpmeta>`,
    )
    .webp({ quality: 95, effort: 5 })
    .toBuffer();
  const payload = {
    version: 1,
    mintId: mint.id,
    listingId: String(mint.listing_id),
    masterSerial: listing.master_serial,
    masterSha256: listing.master_sha256,
    mintNumber: mint.mint_number,
    maxSupply: listing.max_supply,
    tier: mint.tier,
    width,
    height,
    mimeType: "image/webp",
    sha256: sha256(output),
    keyId,
    pipelineVersion:
      mint.tier === "Prismatic"
        ? "foil-v2-prismatic-holo"
        : mint.tier === "Standard"
          ? "foil-v1"
          : "foil-v3-metal-gem",
  };
  const signature = sign(null, Buffer.from(canonicalMintPayload(payload)), privateKey).toString(
    "base64",
  );
  return { bytes: output, manifest: { algorithm: "Ed25519", payload, signature }, width, height };
}
export function verifyReceipt(bytes, receipt, publicKey) {
  return (
    receipt.algorithm === "Ed25519" &&
    receipt.payload.sha256 === sha256(bytes) &&
    verify(
      null,
      Buffer.from(canonicalMintPayload(receipt.payload)),
      publicKey,
      Buffer.from(receipt.signature, "base64"),
    )
  );
}
export async function renderMarketPreview(bytes, job) {
  if (sha256(bytes) !== job.sha256) throw new Error("Minted artifact hash mismatch");
  const base = await sharp(bytes, { limitInputPixels: 100_000_000 })
    .resize({ width: 960, height: 640, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = base.info;
  const stamp = Math.min(226, width, height),
    font = Math.max(6, (14 * stamp) / 226),
    gap = font * 1.5;
  const tile = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="protected" width="${stamp}" height="${stamp}" patternUnits="userSpaceOnUse"><g transform="translate(${stamp / 2},${stamp / 2}) rotate(-45)" text-anchor="middle" font-family="sans-serif" font-size="${font}" font-weight="700" fill="white" fill-opacity=".58" stroke="black" stroke-opacity=".58" stroke-width=".8"><text y="-${gap}">PIXEL SHROOM STUDIO</text><text y="0">PROTECTED PREVIEW</text><text y="${gap}">EDITION ${Number(job.mintNumber)}</text></g></pattern></defs><rect width="100%" height="100%" fill="url(#protected)"/></svg>`,
  );
  return sharp(base.data)
    .composite([{ input: tile }])
    .webp({ quality: 82 })
    .toBuffer();
}
