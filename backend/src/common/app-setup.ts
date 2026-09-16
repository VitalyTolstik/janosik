import type { INestApplication } from "@nestjs/common";
import { ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import helmet from "helmet";

/**
 * The HTTP pipeline shared by main.ts and the e2e specs, so tests always run
 * against exactly the middleware stack production uses.
 */
export function setupApp(app: INestApplication): void {
  app.use(helmet());
  app.use(cookieParser());
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
}
