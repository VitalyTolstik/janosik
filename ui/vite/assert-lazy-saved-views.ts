import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

/**
 * Build guard for the lazy saved-views menu (TASK-177.20).
 *
 * The menu is useful but secondary; it must stay in a dynamic `savedviews`
 * chunk. A broad code-splitting group once pulled its local boundary into that
 * chunk, which made the whole chunk a static entry dependency: the gate still
 * passed because `index.html` gained a modulepreload and the service worker
 * precached it. Fail the build if either document references the chunk again.
 */
export function assertLazySavedViewsPlugin(): Plugin {
  let outDir = "dist";

  return {
    name: "janosik:assert-lazy-saved-views",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      for (const fileName of ["index.html", "sw.js"]) {
        const filePath = path.join(outDir, fileName);
        if (!fs.existsSync(filePath)) continue;
        const source = fs.readFileSync(filePath, "utf8");
        if (source.includes("savedviews")) {
          throw new Error(
            `Saved views must stay lazy, but ${fileName} references the savedviews chunk.`,
          );
        }
      }
    },
  };
}
