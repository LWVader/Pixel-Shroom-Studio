import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.js"],
    testTimeout: 60000,
    coverage: {
      provider: "v8",
      include: ["public/catalog-core.js", "worker.mjs"],
      reporter: ["text", "html", "lcov"],
    },
  },
});
