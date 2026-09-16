import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { env } from "@/config/env";
import { AppModule } from "@/app.module";
import { setupApp } from "@/common/app-setup";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  setupApp(app);
  app.enableShutdownHooks();
  await app.listen(env.PORT);
  console.log(`janosik API listening on http://localhost:${env.PORT}`);
}

void bootstrap();
