import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Vitest config — mirrors the app's `@/` alias; runs in jsdom with React
// Testing Library and a shared setup file. CSS is not loaded in tests.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    // vmThreads boots jsdom once for the whole run instead of per file.
    pool: "vmThreads",
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    coverage: {
      provider: "v8",
      // The critical, logic-heavy layers: the reducer/context/history and
      // every pure utility. UI components are exercised by integration tests
      // but are not part of the threshold yet.
      include: ["src/store/**", "src/utils/**"],
      reporter: ["text", "lcov"],
      // Measured on the current suite (stmts 92.7 / branch 87.6 / funcs
      // 95.5 / lines 97.6); set ~4-5 points lower so CI stays stable while
      // still catching a real regression.
      thresholds: {
        statements: 88,
        branches: 83,
        functions: 91,
        lines: 93,
      },
    },
  },
});
