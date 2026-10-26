import { defineConfig } from "vitest/config";

// Brand package tests: pure data + a parity check between the TS token object
// and the CSS custom properties, so they run in node (no jsdom).
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    coverage: {
      provider: "v8",
      include: ["src/**"],
      reporter: ["text", "lcov"],
    },
  },
});
