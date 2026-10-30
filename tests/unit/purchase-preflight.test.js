import { it, expect } from "vitest";
import { checkPurchaseJourney } from "../../tools/check-purchase-journey.mjs";
it("probes only read-only catalog actions and rejects live Stripe/production fulfillment", async () => {
  const requests = [];
  const run = async (paymentMode, testMode) =>
    checkPurchaseJourney({
      artworkId: 1,
      request: async (url, options) => {
        requests.push(JSON.parse(options.body));
        return Response.json(
          url.includes("forge-api")
            ? {
                paymentMode,
                digitalEnabled: true,
                canvasEnabled: true,
                canvasMappingsReady: true,
                previews: Array.from({ length: 6 }, () => ({
                  previewUrl: "https://example.invalid/preview.webp",
                })),
                edition: { maxSupply: 500, totalMinted: 0, reserved: 0 },
              }
            : { testMode, enabled: true, countries: ["US"] },
        );
      },
    });
  expect((await run("test", true)).readyForProviderTest).toBe(true);
  expect((await run("live", true)).readyForProviderTest).toBe(false);
  expect((await run("test", false)).readyForProviderTest).toBe(false);
  expect(requests.every((b) => ["availability", "catalog"].includes(b.action))).toBe(true);
});
