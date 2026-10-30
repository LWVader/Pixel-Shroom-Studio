import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
// Read-only deployment probe. Never creates a checkout, claims a mint or sends an order.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../public/config.js";
export async function checkPurchaseJourney({ artworkId, request = fetch }) {
  if (!Number.isSafeInteger(Number(artworkId)) || Number(artworkId) < 1)
    throw Error("Pass --artwork followed by your published artwork ID.");
  const read = async (name, body) => {
    const response = await request(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw Error(
        `${name} returned HTTP ${response.status}. Check deployment and function logs; no checkout was created.`,
      );
    return response.json();
  };
  const [roll, print] = await Promise.all([
    read("forge-api", { action: "availability", artworkId: Number(artworkId) }),
    read("print-api", { action: "catalog" }),
  ]);
  const checks = {
    stripeTestMode: roll.paymentMode === "test",
    digitalRollOpen: roll.digitalEnabled === true,
    canvasRollOpen: roll.canvasEnabled === true,
    allCanvasMappingsReady: roll.canvasMappingsReady === true,
    sixProtectedTierPreviews:
      Array.isArray(roll.previews) &&
      roll.previews.length === 6 &&
      roll.previews.every((p) => p.previewUrl),
    supplyRemaining:
      Boolean(roll.edition) &&
      Number(roll.edition.totalMinted || 0) + Number(roll.edition.reserved || 0) <
        Number(roll.edition.maxSupply),
    gelatoDraftMode: print.testMode === true,
    printCheckoutEnabled: print.enabled === true,
    usDelivery: Array.isArray(print.countries) && print.countries.includes("US"),
  };
  return {
    project: SUPABASE_URL,
    artworkId: Number(artworkId),
    paymentMode: roll.paymentMode || "unknown (deploy updated forge-api)",
    readyForProviderTest: Object.values(checks).every(Boolean),
    checks,
    scope:
      "Read-only flags and catalog; does not verify Stripe webhooks, emails, worker delivery or provider orders.",
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const index = process.argv.indexOf("--artwork");
    const result = await checkPurchaseJourney({
      artworkId: index < 0 ? undefined : process.argv[index + 1],
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.readyForProviderTest) {
      console.error(
        "NOT READY: resolve false checks on a staging project before using test payments. Do not replace production Stripe keys to run this test.",
      );
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
