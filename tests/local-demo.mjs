import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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
  for (const tier of ["Standard", "Silver", "Gold", "Emerald", "Sapphire", "Prismatic"]) {
    const response = await page.request.post(
      `http://127.0.0.1:8039/demo/api/mint-access?tier=${tier}`,
      { data: { action: "status" } },
    );
    const fixture = (await response.json()).items[0];
    if (!process.env.DEMO_TIER_DIR) {
      const source = await readFile(
        new URL(`../tools/demo-assets/tiers/${tier.toLowerCase()}.jpg`, import.meta.url),
      );
      assert.equal(
        fixture.manifest.payload.tierSourceSha256,
        createHash("sha256").update(source).digest("hex"),
      );
    }

    await page.locator("#tier").selectOption(tier);
    await page.getByRole("button", { name: "Replay reveal" }).click();
    await demo.getByRole("heading", { name: "Revealing your paid edition" }).waitFor();
    await demo.locator(".foil-card img").evaluate(async (image) => {
      await image.decode();
    });
    assert.equal(await demo.locator(".foil-card").getAttribute("data-tier"), tier);
    await demo.locator('.foil-scene[data-animation="running"]').waitFor();
    assert.match(
      await demo.locator(".foil-seal").evaluate((face) => getComputedStyle(face).backgroundImage),
      /foil-card-back\.jpg/,
    );
    assert.equal(await demo.locator(".foil-back-title").count(), 0);
    const ratio = await demo
      .locator(".foil-rotor")
      .evaluate((card) => card.offsetWidth / card.offsetHeight);
    assert.ok(
      Math.abs(ratio - 1280 / 1909) < 0.01,
      "Card back must retain its portrait proportions",
    );

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
  // The supplied template's post-reveal pointer tilt and sheen work without rerolling.
  await demo.locator(".foil-scene").scrollIntoViewIfNeeded();
  const box = await demo.locator(".foil-scene").boundingBox();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.3);
  assert.equal(
    await demo.locator(".foil-scene").evaluate((scene) => scene.classList.contains("is-tilting")),
    true,
  );
  assert.notEqual(await demo.locator(".foil-rotor").evaluate((card) => card.style.transform), "");
  await demo.getByRole("button", { name: "Replay artwork reveal", exact: true }).focus();
  await page.keyboard.press("Enter");
  await demo.locator('.foil-scene[data-animation="running"]').waitFor();
  assert.equal(
    await demo.locator(".foil-rotor > img").evaluate((image) => getComputedStyle(image).visibility),
    "hidden",
  );
  await demo.locator('.foil-scene[data-animation="complete"]').waitFor();
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
  await demo.getByRole("button", { name: "Add to my collection", exact: true }).click();
  await demo.getByRole("button", { name: "Added to my collection", exact: true }).waitFor();
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
    "PASS local demo: six uploaded-image tier copies, reveal, purchase, selling quote and resale confirmation; no external requests",
  );
} finally {
  await browser?.close();
  child.kill();
}
