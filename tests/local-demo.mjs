import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
const child = spawn(process.execPath, ["tools/demo-server.mjs"], {
  env: {
    ...process.env,
    DEMO_PORT: "8039",
    DEMO_IMAGE: process.env.DEMO_IMAGE || "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let browser;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("Local demo startup timed out")), 60000);
    child.stdout.on("data", (bytes) => {
      if (String(bytes).includes("Open http")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on("data", (bytes) => process.stderr.write(bytes));
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(Error(`Demo exited: ${code}`));
    });
  });
  browser = await chromium.launch(
    process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {},
  );
  const page = await browser.newPage();
  const errors = [],
    external = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://127.0.0.1:8039") {
      external.push(url.origin);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto("http://127.0.0.1:8039/");
  const demo = page.frameLocator("#screen");
  await demo.getByRole("button", { name: "Download variant", exact: true }).waitFor();
  for (const tier of ["Standard", "Silver", "Gold", "Prismatic"]) {
    await page.locator("#tier").selectOption(tier);
    await page.getByRole("button", { name: "Replay reveal" }).click();
    await demo.getByRole("heading", { name: `${tier} edition revealed` }).waitFor();
    await demo.locator(".foil-card img").evaluate(async (image) => {
      await image.decode();
    });
    assert.equal(await demo.locator(".foil-card").getAttribute("data-tier"), tier);
    await demo.locator('.foil-scene[data-animation="running"]').waitFor();
    assert.equal(
      await demo
        .locator(".foil-rotor > img")
        .evaluate((image) => getComputedStyle(image).visibility),
      "hidden",
    );
    assert.equal(
      await demo
        .locator(".foil-seal")
        .evaluate((seal) => getComputedStyle(seal).display !== "none"),
      true,
    );
    // Observe actual painted lightning pixels rather than mirroring its implementation.
    await demo.locator("canvas.foil-lightning").evaluate(
      (canvas) =>
        new Promise((resolve, reject) => {
          const start = performance.now();
          function check() {
            if (
              canvas.closest(".foil-scene").dataset.animation !== "complete" &&
              getComputedStyle(canvas.closest(".foil-scene").querySelector("img")).visibility !==
                "hidden"
            )
              return reject(Error("Artwork leaked during the spin"));
            const context = canvas.getContext("2d");
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
            if (pixels.some((value, index) => index % 4 === 3 && value > 0)) return resolve();
            if (performance.now() - start > 5000) return reject(Error("Lightning was not painted"));
            requestAnimationFrame(check);
          }
          check();
        }),
    );
    if (tier === "Prismatic" && process.env.DEMO_SCREENSHOT)
      await page.screenshot({ path: process.env.DEMO_SCREENSHOT, fullPage: true });
    if (tier !== "Standard")
      await demo.getByRole("button", { name: "Skip animation", exact: true }).click();
    await demo.locator('.foil-scene[data-animation="complete"]').waitFor();
    assert.equal(
      await demo
        .locator(".foil-rotor > img")
        .evaluate((image) => getComputedStyle(image).visibility),
      "visible",
    );
    assert.equal(
      await demo.locator(".foil-seal").evaluate((seal) => getComputedStyle(seal).display),
      "none",
    );
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await demo.getByRole("button", { name: "Replay reveal", exact: true }).click();
  await demo.locator('.foil-scene[data-animation="complete"]').waitFor();
  assert.match(await demo.locator(".foil-animation-status").textContent(), /Motion effects off/);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(
    await demo.locator("body").evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Simulate mint purchase" }).click();
  await demo.locator("#start-mint").click();
  await demo.getByRole("heading", { name: "Simulated checkout" }).waitFor();
  await demo.getByRole("link", { name: "Simulate successful payment" }).click();
  await demo.getByRole("heading", { name: "Prismatic edition revealed" }).waitFor();
  await page.getByRole("button", { name: "My collection / sell" }).click();
  await demo.getByRole("button", { name: "List on Market" }).click();
  await demo.locator("dialog[open]").waitFor();
  await demo.locator("#sell-form input[name=price]").fill("50");
  assert.match(await demo.locator("#sell-summary").textContent(), /\$45\.00/);
  await page.getByRole("button", { name: "Marketplace / buy" }).click();
  await demo.locator("[data-market-buy]").waitFor();
  await demo.locator(".foil-card img").evaluate(async (image) => {
    await image.decode();
  });
  await demo.locator("[data-market-buy]").click();
  await demo.getByRole("link", { name: "Simulate successful payment" }).click();
  await demo.locator("#market-purchase").filter({ hasText: "Payment verified" }).waitFor();
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    "PASS local demo: four real rendered tiers, reveal, purchase, selling quote and resale confirmation; no external requests",
  );
} finally {
  await browser?.close();
  child.kill();
}
