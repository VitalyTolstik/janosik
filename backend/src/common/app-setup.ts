import type { INestApplication } from "@nestjs/common";
import { ValidationPipe } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { MAX_IMPORT_BYTES } from "@janosik/shared";
import { json } from "express";
import type { NextFunction, Request, Response } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { env } from "@/config/env";
import { inlineScriptHashes } from "./csp";

/** JSON body cap for every route that is not import/commands. */
export const DEFAULT_JSON_LIMIT = "256kb";

/**
 * Routes allowed the large body: `POST /boards/import` and
 * `POST /boards/:id/commands` (plus the admin board-content editor, which
 * submits the same commands on the owner's behalf).
 */
const LARGE_BODY_ROUTE =
  /^\/api\/v1\/(boards\/import|boards\/[^/]+\/commands|admin\/boards\/[^/]+\/commands)\/?$/;

/**
 * The HTTP pipeline shared by main.ts and the e2e specs, so tests always run
 * against exactly the middleware stack production uses.
 */
export function setupApp(app: INestApplication): void {
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
  const scriptHashes = inlineScriptHashes([env.STATIC_DIR, env.SITE_DIR]);
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "script-src": ["'self'", ...scriptHashes],
          "style-src": ["'self'", "'unsafe-inline'"],
          "img-src": ["'self'", "data:", "blob:"],
          "media-src": ["'self'", "blob:"],
          "connect-src": ["'self'"],
          "worker-src": ["'self'", "blob:"],
          "font-src": ["'self'", "data:"],
          "upgrade-insecure-requests": null,
        },
      },
    }),
  );
  app.use(cookieParser());
  // JSON body limits. Only two routes legitimately carry big bodies: the
  // board import (up to MAX_IMPORT_BYTES) and the command endpoint (a large
  // RESTORE_* must reach validation instead of dying in the parser —
  // `MAX_COMMAND_BYTES` still caps one command inside the service).
  // Everything else gets `DEFAULT_JSON_LIMIT`, so an unauthenticated
  // `POST /auth/login` can no longer make the server buffer and parse 5 MB.
  const server = app as NestExpressApplication;
  const large = json({ limit: MAX_IMPORT_BYTES });
  const small = json({ limit: DEFAULT_JSON_LIMIT });
  server.use((req: Request, res: Response, next: NextFunction) =>
    (LARGE_BODY_ROUTE.test(req.path) ? large : small)(req, res, next),
  );
  // Nest's own parser stays registered but never sees an unparsed body.
  server.useBodyParser("json", { limit: MAX_IMPORT_BYTES });
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
}
