import {defineConfig, devices} from "@playwright/test";

const baseURL = "http://127.0.0.1:4173";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    launchOptions: executablePath ? {executablePath} : {}
  },
  projects: [
    {name: "desktop", use: {...devices["Desktop Chrome"]}, testMatch: "desktop.spec.mjs"},
    {name: "mobile", use: {...devices["Pixel 7"]}, testMatch: "mobile.spec.mjs"}
  ],
  webServer: {
    command: "node tests/server.mjs",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 15000
  }
});
