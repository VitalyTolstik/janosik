import "dotenv/config";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import helmet from "helmet";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * Rate limiting on auth routes ships with the scaffold (§7.7 TASK-23):
 * 5 requests per minute per IP, the 6th gets a 429. The counter is
 * in-memory and lives inside a single app instance, so the test is
 * self-contained.
 */
describe("Auth rate limit (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(helmet());
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("allows 5 logins then returns 429", async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ email: "user@example.com", password: "secret" })
        .expect(501); // stub until TASK-24
    }
    await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: "user@example.com", password: "secret" })
      .expect(429);
  });

  it("registers are throttled separately from logins", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email: "user@example.com", password: "secret" })
      .expect(501);
  });
});
