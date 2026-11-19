import {readFile, stat} from "node:fs/promises";
import {basename} from "node:path";

import {alreadyUploaded, campaignZipPath, checkZipFile} from "../public/campaign-zip.mjs";

function studioUrl(variable, fallback) {
  const url = new URL(process.env[variable] || fallback);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.username || url.password) {
    throw new Error(`${variable} must point to a trusted HTTPS origin or local development server.`);
  }
  return url.origin;
}

async function main() {
  const [sessionId, archive] = process.argv.slice(2);
  if (!/^cs_(test|live)_[A-Za-z0-9]{12,200}$/.test(sessionId ?? "") || !archive) {
    throw new Error("Usage: node tools/publish-campaign-zip.mjs <checkout-session-id> <campaign.zip>");
  }
  const project = studioUrl("SUPABASE_URL");
  const site = studioUrl("CAMPAIGN_SITE_URL", "https://www.pixelshroomstudio.com");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Set SUPABASE_SERVICE_ROLE_KEY in your private environment file.");

  const fileName = basename(archive);
  const file = await stat(archive);
  if (!file.isFile()) throw new Error("Choose a ZIP file.");
  checkZipFile(fileName, file.size);
  const bytes = await readFile(archive);
  const objectPath = await campaignZipPath(sessionId, fileName, bytes);

  const headers = {apikey: key};
  if (!key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${key}`;
  const briefCheck = new URL("/rest/v1/campaign_briefs", project);
  briefCheck.searchParams.set("select", "checkout_session_id");
  briefCheck.searchParams.set("checkout_session_id", `eq.${sessionId}`);
  const brief = await fetch(briefCheck, {headers, redirect: "error"});
  if (!brief.ok) throw new Error(`Could not look up the order (HTTP ${brief.status}). Check the project and credentials.`);
  if (!(await brief.json()).length) throw new Error("No submitted brief matches that Checkout Session ID.");

  const upload = await fetch(`${project}/storage/v1/object/campaign-zips/${objectPath}`, {
    method: "POST",
    headers: {...headers, "Content-Type": "application/zip", "x-upsert": "false"},
    body: bytes,
    redirect: "error"
  });
  if (!upload.ok) {
    const issue = await upload.json().catch(() => ({}));
    if (upload.status !== 409 && !alreadyUploaded(issue)) throw new Error(`ZIP upload failed (HTTP ${upload.status}). Check Storage settings and the project upload limit.`);
  }
  const delivery = await fetch(`${project}/rest/v1/rpc/publish_campaign_zip`, {
    method: "POST",
    headers: {...headers, "Content-Type": "application/json"},
    body: JSON.stringify({order_session: sessionId, zip_path: objectPath}),
    redirect: "error"
  });
  if (!delivery.ok) {
    throw new Error(`The ZIP could not be linked to the order (HTTP ${delivery.status}). Verify the migrations and run the same command again.`);
  }
  const buyerPage = new URL("/brief.html", site);
  buyerPage.searchParams.set("session_id", sessionId);
  console.log(`Published ${fileName}. Share this private order link with the buyer at their Stripe checkout email:\n${buyerPage.href}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
