import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import helmet from "helmet";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";

describe("Health (e2e)", () => {
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

  it("GET /api/v1/health returns 200 with db up", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/health")
      .expect(200);
    expect(res.body).toEqual({ status: "ok", db: "up" });
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
