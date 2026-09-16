import "reflect-metadata";
import helmet from "helmet";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { env } from "@/config/env";
import { AppModule } from "@/app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.use(helmet());
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableShutdownHooks();
  await app.listen(env.PORT);
  console.log(`janosik API listening on http://localhost:${env.PORT}`);
}

void bootstrap();
