import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { env } from "@/config/env";
import { assertBootSecurity } from "@/config/security";
import { AppModule } from "@/app.module";
import { setupApp } from "@/common/app-setup";

async function bootstrap(): Promise<void> {
  // TASK-38a: refuse a production boot that would silently break cookies.
  assertBootSecurity((message) => Logger.warn(message, "Bootstrap"));
  const app = await NestFactory.create(AppModule);
  setupApp(app);
  app.enableShutdownHooks();
  await app.listen(env.PORT);
  console.log(`janosik API listening on http://localhost:${env.PORT}`);
}

void bootstrap();
