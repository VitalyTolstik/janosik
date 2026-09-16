import { HttpException } from "@nestjs/common";
import { HealthService } from "./health.service";
import type { PrismaService } from "@/common/prisma/prisma.service";

const prismaMock = {
  ping: jest.fn(),
  logError: jest.fn(),
} as unknown as PrismaService;

describe("HealthService", () => {
  let service: HealthService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new HealthService(prismaMock);
  });

  it("reports ok when the database responds", async () => {
    (prismaMock.ping as jest.Mock).mockResolvedValue(undefined);
    await expect(service.check()).resolves.toEqual({
      status: "ok",
      db: "up",
    });
  });

  it("returns 503 with db down when the ping fails", async () => {
    (prismaMock.ping as jest.Mock).mockRejectedValue(new Error("down"));
    const err = await service.check().catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(503);
    expect((err as HttpException).getResponse()).toEqual({
      status: "error",
      db: "down",
    });
    expect(prismaMock.logError).toHaveBeenCalled();
  });
});
