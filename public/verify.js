// SECTION: Supabase access and verification-page elements
import { supabase } from "./supabase-client.js";

const form = document.querySelector("#verify-form");
const button = document.querySelector("#verify-button");
const result = document.querySelector("#verify-result");
const verdict = document.querySelector("#verify-verdict");
const serialInput = document.querySelector("#verify-serial");

const requestedSerial = new URLSearchParams(location.search).get("serial");
if (requestedSerial) serialInput.value = requestedSerial.toUpperCase();

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function identityPayload({ serialNumber, creator, sha256 }) {
  return JSON.stringify({ version: 1, serialNumber, creator, sha256 });
}

async function sha256File(file) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return bytesToHex(new Uint8Array(digest));
}

async function loadSignatureRecord(serialNumber) {
  const { data, error } = await supabase
    .from("artwork_signatures")
    .select("serial_number,creator,sha256,signature,public_key_jwk,payload_version,c2pa_embedded,signed_at")
    .eq("serial_number", serialNumber)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function verifyStudioSignature(record) {
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    record.public_key_jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"]
  );
  const payload = identityPayload({
    serialNumber: record.serial_number,
    creator: record.creator,
    sha256: record.sha256
  });
  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    base64ToBytes(record.signature),
    new TextEncoder().encode(payload)
  );
}

// SECTION: C2PA manifest inspection with the official browser SDK
async function inspectC2pa(file, serialNumber) {
  let c2pa;
  let reader;
  try {
    const module = await import("https://esm.sh/@contentauth/c2pa-web@0.15.2/inline?bundle");
    c2pa = await module.createC2pa();
    reader = module.Reader?.fromBlob
      ? await module.Reader.fromBlob(c2pa, file.type, file)
      : await c2pa.reader.fromBlob(file.type, file);
    if (!reader) return { present: false, serialFound: false };

    const manifestStore = await reader.manifestStore();
    const serialized = JSON.stringify(manifestStore);
    const validationStatus =
      manifestStore?.validation_status ??
      manifestStore?.validationStatus ??
      [];
    return {
      present: true,
      serialFound: serialized.toUpperCase().includes(serialNumber.toUpperCase()),
      valid: Array.isArray(validationStatus) && validationStatus.length === 0
    };
  } catch (error) {
    console.warn("C2PA inspection was unavailable:", error);
    return { present: false, serialFound: false, unavailable: true };
  } finally {
    if (reader?.free) await reader.free();
    if (c2pa?.dispose) c2pa.dispose();
  }
}

function setText(selector, value) {
  document.querySelector(selector).textContent = value;
}

function showResult({ valid, message, serial, creator, hash, signature, c2pa, date }) {
  result.hidden = false;
  verdict.className = `verify-verdict ${valid ? "valid" : "invalid"}`;
  verdict.textContent = message;
  setText("#result-serial", serial || "—");
  setText("#result-creator", creator || "—");
  setText("#result-hash", hash || "—");
  setText("#result-signature", signature || "—");
  setText("#result-c2pa", c2pa || "—");
  setText("#result-date", date || "—");
}

// SECTION: Local file verification
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  button.disabled = true;
  button.textContent = "Verifying locally…";

  try {
    const values = new FormData(form);
    const serialNumber = values.get("serialNumber").trim().toUpperCase();
    const file = values.get("artworkFile");
    if (!(file instanceof File) || !file.size) throw new Error("Select the original artwork file.");

    const [hash, record, c2pa] = await Promise.all([
      sha256File(file),
      loadSignatureRecord(serialNumber),
      inspectC2pa(file, serialNumber)
    ]);
    if (!record) {
      showResult({
        valid: false,
        message: "No Pixel Shroom Studio signature record exists for this serial.",
        serial: serialNumber,
        hash,
        signature: "Not found",
        c2pa: c2pa.present ? "Manifest found" : "Not found"
      });
      return;
    }

    const hashMatches = hash === record.sha256;
    const signatureValid = await verifyStudioSignature(record);
    const fullyValid = hashMatches && signatureValid && c2pa.present && c2pa.valid && c2pa.serialFound;
    const c2paText = c2pa.unavailable
      ? "C2PA check unavailable; retry with an internet connection"
      : c2pa.present
        ? c2pa.serialFound
          ? c2pa.valid
            ? "Manifest valid; LWV serial present"
            : "Manifest found, but C2PA validation reported an error"
          : "Manifest found; LWV serial not found"
        : "No embedded manifest found";

    showResult({
      valid: fullyValid,
      message: fullyValid
        ? "Authentic Pixel Shroom Studio artwork — file hash, studio signature, LWV serial, and C2PA manifest match."
        : "Verification failed — one or more authenticity checks did not match.",
      serial: record.serial_number,
      creator: record.creator,
      hash: `${hash}${hashMatches ? " (match)" : " (does not match registered hash)"}`,
      signature: signatureValid ? "Valid P-256 studio signature" : "Invalid signature",
      c2pa: c2paText,
      date: new Date(record.signed_at).toLocaleString()
    });
  } catch (error) {
    console.error("Artwork verification failed:", error);
    showResult({
      valid: false,
      message: error.message || "Artwork verification failed.",
      signature: "Not verified",
      c2pa: "Not verified"
    });
  } finally {
    button.disabled = false;
    button.textContent = "Verify authenticity";
  }
});
