import { readFileSync } from "node:fs";
import path from "node:path";

import type { Plugin } from "vite";

/**
 * Emits `dist/sw.js` from `src/pwa/sw.js` with `__CACHE_VERSION__` replaced
 * by a hash of the build output (TASK-21.3) and `PRECACHE_ASSETS` filled in
 * with the hashed entry assets the app needs to boot (K-4).
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
const BASE_PLACEHOLDER = "__BASE__";
const PRECACHE_DECLARATION = "const PRECACHE_ASSETS = [];";

/** The parts of a rolldown/vite bundle chunk this plugin reads. */
interface BundleChunk {
  type: "chunk";
  isEntry: boolean;
  imports: string[];
  /** Vite augmentation (not part of rolldown's `OutputChunk` types). */
  viteMetadata?: {
    importedCss?: Set<string>;
    importedAssets?: Set<string>;
  };
}

interface BundleAsset {
  type: "asset";
}

type Bundle = Record<string, BundleChunk | BundleAsset>;

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

/**
 * Collects the URLs of the app's entry assets: every static entry chunk, the
 * chunks it statically imports (the critical path) and the CSS they pull in.
 * Lazy chunks are deliberately excluded — precaching `DescriptionEditor` or
 * the calendar would undo code-splitting. Fonts are left to the worker's
 * cache-first runtime strategy (a first offline boot degrades to fallback
 * fonts rather than eagerly downloading every unicode subset).
 */
export function entryAssetNames(bundle: Bundle, base = "/"): string[] {
  const names = new Set<string>();

  const visit = (fileName: string): void => {
    if (names.has(fileName)) return;
    const chunk = bundle[fileName];
    if (!chunk || chunk.type !== "chunk") return;
    names.add(fileName);
    for (const css of chunk.viteMetadata?.importedCss ?? []) names.add(css);
    for (const imported of chunk.imports) visit(imported);
  };

  for (const [fileName, item] of Object.entries(bundle)) {
    if (item.type === "chunk" && item.isEntry) visit(fileName);
  }

  return [...names].sort().map((fileName) => `${base}${fileName}`);
}

/**
 * Stamps the worker source the way the build does. Exported so tests can
 * load the exact same artifact (`sw.test.ts`) and pass their own precache
 * list — the placeholder declaration keeps the source valid on its own.
 */
export function stampServiceWorkerSource(
  source: string,
  version: string,
  precacheAssets: string[] = [],
  base = "/",
): string {
  return source
    .replaceAll(VERSION_PLACEHOLDER, version)
    .replaceAll(BASE_PLACEHOLDER, base)
    .replace(
      PRECACHE_DECLARATION,
      `const PRECACHE_ASSETS = ${JSON.stringify(precacheAssets)};`,
    );
}

export function serviceWorkerPlugin(): Plugin {
  let base = "/";
  return {
    name: "janosik:service-worker",
    apply: "build",
    configResolved(config) {
      base = config.base;
    },
    generateBundle(_options, bundle) {
      const source = readFileSync(SW_SOURCE, "utf8");
      const version = cacheVersionFrom(Object.keys(bundle));
      const precacheAssets = entryAssetNames(bundle as Bundle, base);
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: stampServiceWorkerSource(source, version, precacheAssets, base),
      });
    },
  };
}
