import { HttpException } from "@nestjs/common";
import { describe, expect, it, jest } from "@jest/globals";

import type { PrismaService } from "@/common/prisma/prisma.service";
import { HealthService } from "./health.service";

/** TASK-119: readiness reflects a configured-but-unreachable Redis. */
describe("HealthService", () => {
  const make = (
    ping: () => Promise<unknown>,
    redis: "up" | "down" | "disabled",
  ): HealthService => {
    const prisma = {
      ping,
      logError: jest.fn(),
    } as unknown as PrismaService;
    const service = new HealthService(prisma);
    jest
      .spyOn(
        service as unknown as { checkRedis: () => Promise<string> },
        "checkRedis",
      )
      .mockResolvedValue(redis);
    return service;
  };

  it("is ready with redis disabled when none is configured", async () => {
    const service = make(() => Promise.resolve(undefined), "disabled");
    await expect(service.check()).resolves.toEqual({
      status: "ok",
      db: "up",
      redis: "disabled",
    });
  });

  it("503s when the db ping fails", async () => {
    const service = make(
      () => Promise.reject(new Error("db down")),
      "disabled",
    );
    await expect(service.check()).rejects.toBeInstanceOf(HttpException);
  });

  it("503s when a configured redis is unreachable", async () => {
    const service = make(() => Promise.resolve(undefined), "down");
    await expect(service.check()).rejects.toBeInstanceOf(HttpException);
  });

  it("is ready when redis is up", async () => {
    const service = make(() => Promise.resolve(undefined), "up");
    await expect(service.check()).resolves.toEqual({
      status: "ok",
      db: "up",
      redis: "up",
    });
  });
});
