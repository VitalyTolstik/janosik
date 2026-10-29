import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";

describe("Health (e2e)", () => {
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

  it("GET /api/v1/health is liveness — 200 without touching a dependency", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/health")
      .expect(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("GET /api/v1/health/ready reports db up and redis disabled", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/health/ready")
      .expect(200);
    // No Redis in the test env → "disabled", not "down" (TASK-119).
    expect(res.body).toEqual({ status: "ok", db: "up", redis: "disabled" });
  });

  it("unknown routes use the default Nest error envelope", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/definitely-not-a-route")
      .expect(404);
    expect(res.body).toMatchObject({
      statusCode: 404,
      error: "Not Found",
    });
  });
});
