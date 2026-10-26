import { defineConfig } from "vitest/config";

// Site unit tests cover the pure i18n/URL helpers, so they run in node.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/i18n/**", "src/utils/**", "src/lib/**"],
      reporter: ["text", "lcov"],
    },
  },
});
