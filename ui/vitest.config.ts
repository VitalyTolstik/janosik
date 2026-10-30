import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Vitest config — mirrors the app's `@/` and `@janosik/shared` aliases; runs
// in jsdom with React Testing Library and a shared setup file. CSS is not
// loaded in tests.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "@janosik/brand": path.resolve(import.meta.dirname, "../brand/src"),
      "@janosik/shared": path.resolve(import.meta.dirname, "../shared/src"),
    },
  },
  test: {
    // vmThreads boots jsdom once for the whole run instead of per file.
    pool: "vmThreads",
    // CI runners are small (2 vCPU / 7 GB) and isolate spawns a fresh worker
    // per file; with a large suite that can exhaust the runner's worker/thread
    // budget and kill a worker mid-start ("Worker exited unexpectedly"). Run
    // one file at a time on CI — the coverage union is identical, only wall
    // time changes. Locally the parallel default stays.
    maxWorkers: process.env.CI ? 1 : undefined,
    environment: "jsdom",
    globals: true,
    // Lazy chunks (calendar, editor) plus userEvent can exceed the 5s
    // default when the whole suite runs in parallel; the assertions are
    // fine, the machine is just busy. Generous ceiling, no slowdown of a
    // green run.
    testTimeout: 15_000,
    hookTimeout: 15_000,
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
