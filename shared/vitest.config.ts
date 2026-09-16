import { defineConfig } from "vitest/config";

// Shared package tests: pure, DOM-free domain logic, so they run in node
// (no jsdom, no setup file). Coverage mirrors the UI gate's thresholds.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    coverage: {
      provider: "v8",
      include: ["src/**"],
      reporter: ["text", "lcov"],
      thresholds: {
        statements: 88,
        branches: 83,
        functions: 91,
        lines: 93,
      },
    },
  },
});
