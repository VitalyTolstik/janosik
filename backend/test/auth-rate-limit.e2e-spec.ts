import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";

/**
 * Strict 5/min quota on the credential endpoints (§7.0). The counter is
 * in-memory per app instance, so this spec gets its own app to stay
 * independent of the other auth specs.
 */
describe("Auth rate limit (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("allows 5 login attempts per minute, the 6th gets 429", async () => {
    const server = request(app.getHttpServer());
    for (let i = 0; i < 5; i++) {
      await server
        .post("/api/v1/auth/login")
        .send({ email: "nobody@example.com", password: "wrong password" })
        .expect(401);
    }
    const res = await server
      .post("/api/v1/auth/login")
      .send({ email: "nobody@example.com", password: "wrong password" })
      .expect(429);
    expect(res.body.statusCode).toBe(429);
  });

  it("registers are throttled under the same quota", async () => {
    const server = request(app.getHttpServer());
    for (let i = 0; i < 5; i++) {
      await server
        .post("/api/v1/auth/register")
        .send({ email: "not-an-email", password: "short" })
        .expect(400);
    }
    await server
      .post("/api/v1/auth/register")
      .send({ email: "not-an-email", password: "short" })
      .expect(429);
  });
});
