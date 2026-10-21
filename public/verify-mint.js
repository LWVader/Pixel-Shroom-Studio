import { invoke } from "./supabase-client.js";
import { canonicalMintPayload } from "./mint-core.js";
const form = document.querySelector("#verify-mint-form"),
  status = document.querySelector("#mint-verdict");
form.onsubmit = async (event) => {
  event.preventDefault();
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const values = new FormData(form);
    const file = values.get("mintFile"),
      receiptFile = values.get("receiptFile");
    if (!file?.size || !receiptFile?.size || receiptFile.size > 65536)
      throw new Error("Select your issued edition image and its signed JSON receipt.");
    const receipt = JSON.parse(await receiptFile.text());
    if (receipt.algorithm !== "Ed25519" || receipt.payload?.version !== 1)
      throw new Error("Unsupported receipt.");
    const { publicKey } = await invoke("mint-access", {
      action: "key",
      keyId: receipt.payload.keyId,
    });
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    const key = await crypto.subtle.importKey("jwk", publicKey, { name: "Ed25519" }, false, [
      "verify",
    ]);
    const valid =
      digest === receipt.payload.sha256 &&
      (await crypto.subtle.verify(
        "Ed25519",
        key,
        Uint8Array.from(atob(receipt.signature), (c) => c.charCodeAt(0)),
        new TextEncoder().encode(canonicalMintPayload(receipt.payload)),
      ));
    status.textContent = valid
      ? `Verified studio-issued ${receipt.payload.tier} variant, #${receipt.payload.mintNumber} of ${receipt.payload.maxSupply}. This confirms the file and signed receipt, not current ownership or value.`
      : "Verification failed. The file or receipt differs from the signed edition.";
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
};
