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
    throw Error("Save the image position again before publishing. The file has changed.");
  const report = evaluatePrint(facts, product.print_specs);
  if (product.active && (report.state !== "ready" || product.publish_confirmed !== true))
    throw Error("Cannot publish: technical checks must pass and publishing must be confirmed.");
  return { facts, report };
}

// Recompute source detail from private bytes, not the export's DPI or client dimensions.
export async function validatePositionedSource(
  db: any,
  product: any,
  report: any,
  printFacts?: any,
) {
  if (!product.position) return null;
  const p = product.position;
  if (!new RegExp(`^gelato/${product.id}/[0-9a-f-]{36}\\.(png|jpg|pdf)$`).test(p.source_path))
    throw Error("Invalid position source. Load and save the image again.");
  const source = await inspectStoredPrint(db, p.source_path);
  if (source.sha256 !== p.source_sha256)
    throw Error("Position source changed. Reload and save the image position again.");
  const { positionedResolution, normalizePosition } =
    await import("../../../public/print-position-core.js");
  const position = normalizePosition(p);
  const resolution = positionedResolution(source.width, source.height, report.specs, position);
  if (
    printFacts &&
    (printFacts.width !== resolution.width || printFacts.height !== resolution.height)
  )
    throw Error(
      "Positioned print dimensions do not match the saved source crop. Save image position again.",
    );
  return {
    ...position,
    source_path: p.source_path,
    source_sha256: source.sha256,
    sourceWidth: source.width,
    sourceHeight: source.height,
    effectiveSourcePpi: resolution.effectivePpi,
  };
}
