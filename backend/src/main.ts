import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { env } from "@/config/env";
import { assertBootSecurity } from "@/config/security";
import { AppModule } from "@/app.module";
import { setupApp } from "@/common/app-setup";
import { serveSpa } from "@/common/serve-spa";

async function bootstrap(): Promise<void> {
  // TASK-38a: refuse a production boot that would silently break cookies.
  assertBootSecurity((message) => Logger.warn(message, "Bootstrap"));
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  setupApp(app);
  // TASK-38b: one container serves the built UI too (no-op when unset).
  serveSpa(app, env.STATIC_DIR);
  app.enableShutdownHooks();
  await app.listen(env.PORT);
  console.log(`janosik API listening on http://localhost:${env.PORT}`);
}

void bootstrap();
