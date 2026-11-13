import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { env } from "@/config/env";
import { assertBootSecurity } from "@/config/security";
import { AppModule } from "@/app.module";
import { setupApp } from "@/common/app-setup";
import { serveFrontends } from "@/common/serve-frontends";
import { prepareRuntimeSite } from "@/common/runtime-site";
import { appBasePrefix } from "@/common/ui-base";

async function bootstrap(): Promise<void> {
  // TASK-38a: refuse a production boot that would silently break cookies.
  assertBootSecurity((message) => Logger.warn(message, "Bootstrap"));
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const siteDir = prepareRuntimeSite(env.SITE_DIR, env.PUBLIC_ORIGIN);
  setupApp(app, { siteDir });
  // TASK-38b/123: one container serves the built frontends too — the
  // marketing site at `/` and the app under `UI_BASE` (no-ops when unset).
  serveFrontends(app, {
    appDir: env.STATIC_DIR,
    appBase: appBasePrefix(),
    siteDir,
  });
  app.enableShutdownHooks();
  await app.listen(env.PORT);
  console.log(`janosik API listening on http://localhost:${env.PORT}`);
}

void bootstrap();
