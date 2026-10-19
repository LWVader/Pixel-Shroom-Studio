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
export async function renderMint(bytes, { mint, listing }, privateKey, keyId) {
  if (
    !FOIL_TIERS.includes(mint.tier) ||
    !Number.isInteger(mint.mint_number) ||
    mint.mint_number < 1 ||
    mint.mint_number > listing.max_supply
  )
    throw new Error("Invalid allocated mint");
  await validateMaster(bytes, listing);
  // Decode/re-encode deliberately: master C2PA metadata cannot describe a derivative.
  let image = sharp(bytes, { limitInputPixels: 100_000_000, animated: false })
    .rotate()
    .resize({ width: 16000, height: 16000, fit: "inside", withoutEnlargement: true });
  if (mint.tier === "Gold") image = image.modulate({ saturation: 1.2 });
  if (mint.tier === "Prismatic")
    image = image.negate({ alpha: false }).tint({ r: 195, g: 35, b: 220 });
  const base = await image.png().toBuffer({ resolveWithObject: true });
  const { width, height } = base.info;
  const stroke = Math.max(3, Math.round(Math.min(width, height) * 0.035));
  const color = mint.tier === "Gold" ? "#eac15a" : "#c6cedc";
  const overlay =
    mint.tier === "Standard"
      ? []
      : [
          {
            input: Buffer.from(
              `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="foil"><stop stop-color="${mint.tier === "Prismatic" ? "#58e8ff" : color}"/><stop offset=".5" stop-color="#ffffff"/><stop offset="1" stop-color="${mint.tier === "Prismatic" ? "#ec52ee" : color}"/></linearGradient></defs><rect x="${stroke / 2}" y="${stroke / 2}" width="${width - stroke}" height="${height - stroke}" fill="none" stroke="url(#foil)" stroke-width="${stroke}"/></svg>`,
            ),
          },
        ];
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
    pipelineVersion: "foil-v1",
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
