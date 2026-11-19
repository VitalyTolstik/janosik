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

  it("limits unauthenticated password-reset requests to three per hour", async () => {
    const server = request(app.getHttpServer());
    const requestReset = () =>
      server.post("/api/v1/auth/password/reset/request").send({
        email: "unknown-reset@example.com",
      });

    for (let i = 0; i < 3; i++) {
      await requestReset().expect(200, { status: "ok" });
    }
    const response = await requestReset().expect(429);
    expect(response.body).toMatchObject({
      code: "rate_limited",
      retryAfter: expect.any(Number),
    });
    expect(response.body.retryAfter).toBeGreaterThan(60);
  });

  it("limits unauthenticated password-reset confirmations to ten per minute", async () => {
    const server = request(app.getHttpServer());
    const confirmReset = () =>
      server.post("/api/v1/auth/password/reset/confirm").send({
        email: "unknown-reset@example.com",
        code: "0".repeat(32),
        newPassword: "new-password",
      });

    for (let i = 0; i < 10; i++) {
      const response = await confirmReset().expect(400);
      expect(response.body.code).toBe("validation_failed");
    }
    const response = await confirmReset().expect(429);
    expect(response.body).toMatchObject({
      code: "rate_limited",
      retryAfter: expect.any(Number),
    });
    expect(response.body.retryAfter).toBeLessThanOrEqual(60);
  });
});
