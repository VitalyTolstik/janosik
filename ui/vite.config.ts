import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { serviceWorkerPlugin } from "./vite/sw-plugin.ts";

// Vite config: React plugin + Tailwind v4 plugin + `@/` path alias.
// Vendor chunks (TASK-19): stable, long-cached groups + parallel loading.
// Vite 8 is Rolldown-based, so chunking is configured via `codeSplitting`
// groups rather than the classic `manualChunks` function. MDXEditor and
// react-day-picker arrive via React.lazy imports and split on their own —
// no group for MDXEditor: a manual chunk around its CJS deps breaks
// rolldown's require interop across chunks (crash at <Lazy> in prod).
export default defineConfig({
  // The app can be served from a sub-path (e.g. `/app/` when the marketing
  // site owns the root — see the Dockerfile). Defaults to the root so dev and
  // standalone deployments are unchanged; the value must keep both slashes.
  base: process.env.UI_BASE ?? "/",
  plugins: [react(), tailwindcss(), serviceWorkerPlugin()],
  // Same-origin API in dev (TASK-29): the UI calls `/api/v1`, Vite forwards
  // to the backend on :3000 — production nginx proxies the same path.
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "@janosik/brand": path.resolve(import.meta.dirname, "../brand/src"),
      "@janosik/shared": path.resolve(import.meta.dirname, "../shared/src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        codeSplitting: {
          // Capture ONLY the modules matching `test` — the default recursive
          // dependency pull-in swallowed shared vendors (react-dom) into the
          // mdxeditor chunk, dragging it back onto the critical path.
          includeDependenciesRecursively: false,
          groups: [
            // Date calendar, loaded on first date popover open. date-fns has
            // its own group: CalendarView formats with it eagerly, while
            // react-day-picker arrives only with the first popover.
            {
              name: "daypicker",
              test: /[\\/]node_modules[\\/]react-day-picker[\\/]/,
            },
            {
              name: "datefns",
              test: /[\\/]node_modules[\\/]date-fns[\\/]/,
            },
            // Framework core — changes rarely, cached long.
            {
              name: "react",
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
            },
            // UI primitives used across the whole app.
            { name: "radix", test: /[\\/]node_modules[\\/]@radix-ui[\\/]/ },
            { name: "dndkit", test: /[\\/]node_modules[\\/]@dnd-kit[\\/]/ },
            // Animated icons across the header — same vendor-cache treatment.
            // The `motion` entry is a thin re-export; the code lives in
            // framer-motion/motion-dom/motion-utils.
            {
              name: "motion",
              test: /[\\/]node_modules[\\/](motion|framer-motion|motion-dom|motion-utils)[\\/]/,
            },
          ],
        },
      },
    },
  },
});
