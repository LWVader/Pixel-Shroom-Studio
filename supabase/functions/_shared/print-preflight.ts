import {
  inspectPrintBytes,
  normalizeSpecs,
  evaluatePrint,
} from "../../../public/print-preflight-core.js";
export { inspectPrintBytes, normalizeSpecs, evaluatePrint };
export async function inspectStoredPrint(db: any, path: string) {
  const { data, error } = await db.storage.from("gelato-print-files").download(path);
  if (error || !data || data.size > 104857600)
    throw Error("Private print file unavailable or larger than 100 MB.");
  const buffer = await data.arrayBuffer();
  const facts = inspectPrintBytes(buffer);
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  const sha256 = Array.from(new Uint8Array(hash))
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  return { ...facts, sha256 };
}

export async function validatePrintMapping(db: any, product: any) {
  const facts = await inspectStoredPrint(db, product.print_path);
  if (!product.print_path.endsWith("." + facts.format))
    throw Error("File contents do not match the uploaded format.");
  if (!product.preflight_hash || facts.sha256 !== product.preflight_hash)
    throw Error("Run Safe check on this exact file before saving. The file has changed.");
  const report = evaluatePrint(facts, product.print_specs);
  if (product.active && (report.state !== "ready" || product.publish_confirmed !== true))
    throw Error("Cannot publish: technical checks must pass and publishing must be confirmed.");
  return { facts, report };
}
