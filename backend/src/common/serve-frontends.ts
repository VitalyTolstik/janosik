import fs from "node:fs";
import path from "node:path";
import { Logger } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { NextFunction, Request, Response } from "express";

/**
 * Serve the built frontends from the API process (TASK-38b, TASK-123). One
 * container runs the whole product:
 *
 *   - the marketing site + docs (Astro) at the site root `/`;
 *   - the app (React SPA) under a base (`/app/`), so the two can coexist;
 *   - the API under `/api/v1`.
 *
 * The routing contract mirrors `deploy/nginx.conf`:
 *   - hashed build output is immutable for a year (site `/_astro/*`,
 *     app `/app/assets/*`);
 *   - `index.html` and `sw.js` are revalidated (a cached shell would pin old
 *     asset URLs after a deploy);
 *   - unknown app paths fall back to the app shell (BrowserRouter deep links);
 *   - unknown site paths return the site's `404.html`;
 *   - `/api/*` is never swallowed;
 *   - public share pages (`<base>s/*`) stay framable (`?embed=1`) and noindex.
 *
 * Each directory is optional: an unset `SITE_DIR` (or one without an
 * `index.html`) is simply not served, so dev, e2e and API-only deployments
 * are unchanged.
 */
export interface FrontendConfig {
  /** Built app (index.html + assets); empty = not served. */
  appDir: string;
  /** Sub-path the app is served from (`/app/` or `/`); always slashed. */
  appBase: string;
  /** Built marketing site + docs; empty = not served. */
  siteDir: string;
}

/** `"/app"` → `"/app/"`, `"/"` → `"/"`. */
function normalizeBase(base: string): string {
  const trimmed = base.trim().replace(/^\/+|\/+$/g, "");
  return trimmed === "" ? "/" : `/${trimmed}/`;
}

/** Resolve a directory that actually holds an `index.html`, else `null`. */
function resolveDir(dir: string, label: string): string | null {
  if (dir.trim() === "") return null;
  const root = path.resolve(dir);
  if (!fs.existsSync(path.join(root, "index.html"))) {
    Logger.warn(
      `${label} "${root}" has no index.html — not serving it`,
      "Bootstrap",
    );
    return null;
  }
  return root;
}

export function serveFrontends(
  app: NestExpressApplication,
  config: FrontendConfig,
): void {
  const appRoot = resolveDir(config.appDir, "STATIC_DIR");
  const siteRoot = resolveDir(config.siteDir, "SITE_DIR");
  const base = normalizeBase(config.appBase);
  const appIndex = appRoot === null ? null : path.join(appRoot, "index.html");

  if (siteRoot !== null) {
    app.useStaticAssets(siteRoot, {
      index: "index.html",
      setHeaders: (res, filePath) => {
        if (filePath.split(path.sep).includes("_astro")) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else if (filePath.endsWith("index.html")) {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    });
  }

  if (appRoot !== null) {
    app.useStaticAssets(appRoot, {
      index: false,
      prefix: base,
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
  }

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    // The API, the public share API and the queue dashboard live under
    // `/api/v1` — never fall back for them.
    if (req.path.startsWith("/api/")) return next();

    const withoutBase = base === "/" ? "" : base.slice(0, -1);
    const isAppPath =
      appIndex !== null &&
      (base === "/" || req.path === withoutBase || req.path.startsWith(base));

    if (isAppPath && appIndex !== null) {
      // Public share pages may be embedded by any site (TASK-58 `?embed=1`).
      if (req.path.startsWith(`${base}s/`)) {
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
      res.sendFile(appIndex, (error) => {
        if (error) next(error);
      });
      return;
    }

    if (siteRoot !== null) {
      const notFound = path.join(siteRoot, "404.html");
      const file = fs.existsSync(notFound)
        ? notFound
        : path.join(siteRoot, "index.html");
      res.status(404).setHeader("Cache-Control", "no-cache");
      res.sendFile(file, (error) => {
        if (error) next(error);
      });
      return;
    }

    next();
  });

  if (siteRoot !== null)
    Logger.log(`Serving site from ${siteRoot}`, "Bootstrap");
  if (appRoot !== null) {
    Logger.log(`Serving app from ${appRoot} at ${base}`, "Bootstrap");
  }
}
