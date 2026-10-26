import fs from "node:fs";
import path from "node:path";
import { Logger } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { NextFunction, Request, Response } from "express";

/**
 * Serve the built SPA from the API process (TASK-38b). One container runs the
 * whole app: the static build plus the API under `/api/v1`, so a self-hoster
 * needs no separate nginx and no proxy config — SSE and cookies work out of
 * the box on a single origin.
 *
 * The routing contract mirrors `deploy/nginx.conf`:
 *   - hashed `/assets/*` are immutable for a year;
 *   - `index.html` and `sw.js` are revalidated (a cached shell would pin old
 *     asset URLs after a deploy);
 *   - unknown GET paths fall back to `index.html` (BrowserRouter deep links);
 *   - `/api/*` is never swallowed by the fallback;
 *   - `/s/*` (public share pages) is framable — `?embed=1` is embedded in
 *     third-party pages — and marked `noindex`.
 *
 * Called from `main.ts` with `env.STATIC_DIR`; a no-op when that is empty, so
 * dev, e2e and API-only deployments are unchanged.
 */
export function serveSpa(app: NestExpressApplication, dir: string): void {
  const root = dir.trim() === "" ? "" : path.resolve(dir);
  if (root === "") return;
  const indexFile = path.join(root, "index.html");
  if (!fs.existsSync(indexFile)) {
    Logger.warn(
      `STATIC_DIR "${root}" has no index.html — serving the API only`,
      "Bootstrap",
    );
    return;
  }

  app.useStaticAssets(root, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.split(path.sep).includes("assets")) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else if (
        filePath.endsWith("index.html") ||
        filePath.endsWith(`${path.sep}sw.js`)
      ) {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    // The API, the public share API and the queue dashboard all live under
    // `/api/v1` — never fall back for them.
    if (req.path.startsWith("/api/")) return next();
    if (req.path.startsWith("/s/")) {
      // Public share pages may be embedded by any site (TASK-58 `?embed=1`).
      res.removeHeader("X-Frame-Options");
      const csp = res.getHeader("Content-Security-Policy");
      if (typeof csp === "string") {
        res.setHeader(
          "Content-Security-Policy",
          csp.replace("frame-ancestors 'self'", "frame-ancestors *"),
        );
      }
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
    }
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(indexFile, (error) => {
      if (error) next(error);
    });
  });

  Logger.log(`Serving SPA from ${root}`, "Bootstrap");
}
