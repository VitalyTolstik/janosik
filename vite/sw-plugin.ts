import { readFileSync } from "node:fs";
import path from "node:path";

import type { Plugin } from "vite";

/**
 * Emits `dist/sw.js` from `src/pwa/sw.js` with `__CACHE_VERSION__` replaced
 * by a hash of the build output (TASK-21.3).
 *
 * The service worker lives outside `public/` on purpose: files there are
 * copied verbatim, so the placeholder would ship as-is and `CACHE_VERSION`
 * would stay frozen across deploys — `activate` would then never delete the
 * previous build's `/assets/*`, and those stale immutable entries would be
 * served to a returning visitor forever.
 *
 * Build-only: the worker is registered in production builds alone
 * (`registerServiceWorker`), so the dev server has nothing to serve.
 */
const SW_SOURCE = path.resolve(import.meta.dirname, "../src/pwa/sw.js");
const VERSION_PLACEHOLDER = "__CACHE_VERSION__";

/**
 * Stable short hash (FNV-1a) over the emitted file names. Names are
 * content-hashed by the bundler, so the digest changes exactly when the
 * build output does — identical rebuilds keep the caches warm.
 */
export function cacheVersionFrom(fileNames: string[]): string {
  let hash = 0x811c9dc5;
  for (const name of [...fileNames].sort()) {
    for (let i = 0; i < name.length; i += 1) {
      hash ^= name.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return `janosik-${hash.toString(16).padStart(8, "0")}`;
}

export function serviceWorkerPlugin(): Plugin {
  return {
    name: "janosik:service-worker",
    apply: "build",
    generateBundle(_options, bundle) {
      const source = readFileSync(SW_SOURCE, "utf8");
      const version = cacheVersionFrom(Object.keys(bundle));
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: source.replaceAll(VERSION_PLACEHOLDER, version),
      });
    },
  };
}
