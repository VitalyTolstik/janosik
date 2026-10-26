import type { INestApplication } from "@nestjs/common";
import { ValidationPipe } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { MAX_IMPORT_BYTES } from "@janosik/shared";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { env } from "@/config/env";

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
  app.use(helmet());
  app.use(cookieParser());
  // Explicit json limit instead of Express's implicit 100 KB (TASK-30.2):
  // import envelopes may legitimately reach MAX_IMPORT_BYTES, and a large
  // RESTORE_* command must reach validation instead of dying in the parser.
  // `MAX_COMMAND_BYTES` still caps one command inside the service.
  (app as NestExpressApplication).useBodyParser("json", {
    limit: MAX_IMPORT_BYTES,
  });
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
}
