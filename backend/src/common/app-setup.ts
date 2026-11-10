import type { INestApplication } from "@nestjs/common";
import { ValidationPipe } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { MAX_COMMAND_BODY_BYTES, MAX_IMPORT_BYTES } from "@janosik/shared";
import { json } from "express";
import type { NextFunction, Request, Response } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { env } from "@/config/env";
import { inlineScriptHashes } from "./csp";
import { requestContext } from "./request-context";

/** JSON body cap for every route that is not import/commands. */
export const DEFAULT_JSON_LIMIT = "256kb";
const DEFAULT_JSON_LIMIT_BYTES = 256 * 1024;

/**
 * TASK-166 route-specific body caps. The import envelope and a command/plan
 * body are deliberately different: an import may be 25 MB, while a single
 * command batch is capped at 10 MB so it cannot inherit the import budget.
 */
const IMPORT_BODY_ROUTE = /^\/api\/v1\/boards\/import\/?$/;
const COMMAND_BODY_ROUTE =
  /^\/api\/v1\/(?:boards\/[^/]+\/(?:commands(?:\/batch)?|plans(?:\/apply)?)|admin\/boards\/[^/]+\/commands(?:\/batch)?)\/?$/;

interface BodyParserError extends Error {
  type?: string;
  status?: number;
}

/**
 * The HTTP pipeline shared by main.ts and the e2e specs, so tests always run
 * against exactly the middleware stack production uses.
 */
export function setupApp(app: INestApplication): void {
  // Trace context first (TASK-153): every later middleware, guard and query
  // runs with the request id available for logs.
  app.use(requestContext);
  // Reverse-proxy trust (TASK-91): with N trusted hops Express resolves
  // `req.ip` from the rightmost X-Forwarded-For entry it can vouch for, so
  // the throttler, the IP allowlist and the audit log see the real client.
  // Off by default (a direct connection's socket address is the truth).
  if (env.TRUST_PROXY > 0) {
    (app as NestExpressApplication).set("trust proxy", env.TRUST_PROXY);
  }
  // CSP tuned for the app shell (TASK-38b serves the SPA from this process):
  // the theme preflight in index.html is an inline script — allowed by its
  // sha256, computed at boot from the served files (no `'unsafe-inline'`
  // for scripts); its inline style stays allowed. Avatars and attachments
  // load as blob:, the service worker is same-origin, and
  // `upgrade-insecure-requests` is dropped so a plain-HTTP self-host works
  // (helmet would otherwise rewrite every subresource to https).
  // `wasm-unsafe-eval` lets Pagefind compile its search index in the docs
  // (a worker wasm module); without it the dialog stays on "Searching...".
  // The marketing site can opt into a cookieless Plausible script at build
  // time (`PUBLIC_ANALYTICS_DOMAIN`), so its origin must be allowed here too;
  // otherwise the script and its event beacon are silently blocked.
  const analyticsOrigin = "https://plausible.io";
  const scriptHashes = inlineScriptHashes([env.STATIC_DIR, env.SITE_DIR]);
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "script-src": [
            "'self'",
            "'wasm-unsafe-eval'",
            analyticsOrigin,
            ...scriptHashes,
          ],
          "style-src": ["'self'", "'unsafe-inline'"],
          "img-src": ["'self'", "data:", "blob:"],
          "media-src": ["'self'", "blob:"],
          "connect-src": ["'self'", analyticsOrigin],
          "worker-src": ["'self'", "blob:"],
          "font-src": ["'self'", "data:"],
          "upgrade-insecure-requests": null,
        },
      },
    }),
  );
  app.use(cookieParser());
  // JSON body limits (TASK-166): three route classes, one parser each.
  // Import may carry a 25 MB envelope; a command/plan body is capped at
  // 10 MB (`MAX_COMMAND_BYTES` still caps one command inside the service);
  // everything else gets `DEFAULT_JSON_LIMIT`, so an unauthenticated
  // `POST /auth/login` can no longer make the server buffer a large body.
  const server = app as NestExpressApplication;
  const importParser = json({ limit: MAX_IMPORT_BYTES });
  const commandParser = json({ limit: MAX_COMMAND_BODY_BYTES });
  const smallParser = json({ limit: DEFAULT_JSON_LIMIT });
  server.use((req: Request, res: Response, next: NextFunction) => {
    const path = req.path;
    const parser = IMPORT_BODY_ROUTE.test(path)
      ? importParser
      : COMMAND_BODY_ROUTE.test(path)
        ? commandParser
        : smallParser;
    const limit = IMPORT_BODY_ROUTE.test(path)
      ? MAX_IMPORT_BYTES
      : COMMAND_BODY_ROUTE.test(path)
        ? MAX_COMMAND_BODY_BYTES
        : DEFAULT_JSON_LIMIT_BYTES;
    parser(req, res, (error?: BodyParserError) => {
      if (error === undefined) {
        next();
        return;
      }
      // TASK-166: an oversized body is a machine-readable 413, not a generic
      // parser error. Other parser failures keep their normal path.
      if (error.type === "entity.too.large") {
        res.status(413).json({
          statusCode: 413,
          code: "payload_too_large",
          message: `Request body exceeds the ${formatBytes(limit)} limit`,
          limit,
          retryable: false,
        });
        return;
      }
      next(error);
    });
  });
  // Nest's own parser stays registered but never sees an unparsed body.
  server.useBodyParser("json", { limit: MAX_IMPORT_BYTES });
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${Math.round(bytes / (1024 * 1024))} MB`
    : `${Math.round(bytes / 1024)} KB`;
}
