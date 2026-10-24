import { inspectPrintBytes } from "../../../public/print-preflight-core.js";
const tiers = ["Standard", "Silver", "Gold", "Emerald", "Sapphire", "Prismatic"];
// Called only after print-api has authenticated the studio administrator.
export async function reuseTierPrintSource(
  db: any,
  productId: string,
  artworkId: number,
  tier: string,
) {
  if (
    !/^[0-9a-f-]{36}$/i.test(productId) ||
    !Number.isSafeInteger(artworkId) ||
    artworkId < 1 ||
    !tiers.includes(tier)
  )
    throw Error("Choose an existing artwork and tier.");
  const { data: asset, error } = await db
    .from("foil_tier_assets")
    .select("path,sha256,mime_type")
    .eq("listing_id", artworkId)
    .eq("tier", tier)
    .single();
  if (error || !asset) throw Error("Upload and save this tier image in Images first.");
  if (!["image/png", "image/jpeg"].includes(asset.mime_type))
    throw Error(
      "Use PNG or JPEG for the shared tier/print image. Re-export this tier in Images before printing.",
    );
  const { data: source, error: downloadError } = await db.storage
    .from("originals")
    .download(asset.path);
  if (downloadError || !source || source.size > 104857600)
    throw Error("The uploaded tier file is unavailable or exceeds 100 MB.");
  const bytes = await source.arrayBuffer();
  const facts = inspectPrintBytes(bytes);
  if (!["png", "jpg"].includes(facts.format))
    throw Error(
      "Printing reuses PNG or JPEG tier images. Export and upload a PNG or JPEG in Images; the automatic checker cannot approve PDF or WebP.",
    );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = Array.from(new Uint8Array(digest))
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  if (sha256 !== asset.sha256)
    throw Error(
      "The stored tier image no longer matches its registered hash. Reload the correct source in Images.",
    );
  const path = `gelato/${productId}/${crypto.randomUUID()}.${facts.format}`;
  const { error: uploadError } = await db.storage.from("gelato-print-files").upload(path, source, {
    contentType: facts.format === "png" ? "image/png" : "image/jpeg",
    upsert: false,
  });
  if (uploadError) throw uploadError;
  const { data: preview, error: previewError } = await db.storage
    .from("gelato-print-files")
    .createSignedUrl(path, 600);
  if (previewError || !preview?.signedUrl) throw Error("Cannot open the private image preview.");
  return { path, facts: { ...facts, sha256 }, previewUrl: preview.signedUrl, artworkId, tier };
}
