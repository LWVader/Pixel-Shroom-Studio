export const maxZipBytes = 50 * 1024 * 1024;

export function checkZipFile(name, size) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,115}\.zip$/.test(name)) {
    throw new Error("Use a filename such as Orbit-Roast-Campaign.zip with letters, numbers, hyphens, dots or underscores.");
  }
  if (size > maxZipBytes || size < 22) throw new Error("Choose a ZIP file up to 50 MiB.");
}

export async function campaignZipPath(orderId, name, bytes) {
  checkZipFile(name, bytes.length);
  const zip = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (zip.getUint32(0, true) !== 0x04034b50) throw new Error("Choose a valid, non-empty ZIP file.");
  let end = bytes.length - 22;
  const firstCandidate = Math.max(0, end - 65535);
  while (end >= firstCandidate) {
    if (zip.getUint32(end, true) === 0x06054b50 &&
        end + 22 + zip.getUint16(end + 20, true) === bytes.length) break;
    end--;
  }
  if (end < firstCandidate) throw new Error("The ZIP has an incomplete directory.");

  const prefix = new TextEncoder().encode(orderId + "\0");
  const content = new Uint8Array(prefix.length + bytes.length);
  content.set(prefix);
  content.set(bytes, prefix.length);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", content));
  const key = Array.from(hash, (part) => part.toString(16).padStart(2, "0")).join("");
  return `${key}/${name}`;
}

export function alreadyUploaded(result) {
  return [result?.status, result?.statusCode, result?.originalError?.statusCode].some((value) => String(value) === "409") ||
    ["Duplicate", "ResourceAlreadyExists"].includes(result?.error) ||
    /(?:already exists|duplicate)/i.test(result?.message ?? "");
}
