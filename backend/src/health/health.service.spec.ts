import { HttpException } from "@nestjs/common";
import { describe, expect, it, jest } from "@jest/globals";

import type { PrismaService } from "@/common/prisma/prisma.service";
import { HealthService } from "./health.service";

/**
 * TASK-119: readiness reflects a configured-but-unreachable Redis.
 * TASK-147 (B2): liveness is dependency-free and readiness is cached.
 */
describe("HealthService", () => {
  const make = (
    ping: () => Promise<unknown>,
    redis: "up" | "down" | "disabled",
  ): { service: HealthService; checkRedis: ReturnType<typeof jest.spyOn> } => {
    const prisma = {
      ping,
      logError: jest.fn(),
    } as unknown as PrismaService;
    const service = new HealthService(prisma);
    const checkRedis = jest
      .spyOn(
        service as unknown as { checkRedis: () => Promise<string> },
        "checkRedis",
      )
      .mockResolvedValue(redis);
    return { service, checkRedis };
  };

  it("answers liveness without touching a dependency", () => {
    const { service, checkRedis } = make(
      () => Promise.reject(new Error("must not be called")),
      "down",
    );
    expect(service.liveness()).toEqual({ status: "ok" });
    expect(checkRedis).not.toHaveBeenCalled();
  });

  it("is ready with redis disabled when none is configured", async () => {
    const { service } = make(() => Promise.resolve(undefined), "disabled");
    await expect(service.ready()).resolves.toEqual({
      status: "ok",
      db: "up",
      redis: "disabled",
    });
  });

  it("503s when the db ping fails", async () => {
    const { service } = make(
      () => Promise.reject(new Error("db down")),
      "disabled",
    );
    await expect(service.ready()).rejects.toBeInstanceOf(HttpException);
  });

  it("503s when a configured redis is unreachable", async () => {
    const { service } = make(() => Promise.resolve(undefined), "down");
    await expect(service.ready()).rejects.toBeInstanceOf(HttpException);
  });

  it("is ready when redis is up", async () => {
    const { service } = make(() => Promise.resolve(undefined), "up");
    await expect(service.ready()).resolves.toEqual({
      status: "ok",
      db: "up",
      redis: "up",
    });
  });

  it("caches readiness so a probe burst reaches the dependencies once", async () => {
    const { service, checkRedis } = make(
      () => Promise.resolve(undefined),
      "disabled",
    );
    const results = await Promise.all([
      service.ready(),
      service.ready(),
      service.ready(),
    ]);
    expect(results).toEqual([
      { status: "ok", db: "up", redis: "disabled" },
      { status: "ok", db: "up", redis: "disabled" },
      { status: "ok", db: "up", redis: "disabled" },
    ]);
    expect(checkRedis).toHaveBeenCalledTimes(1);
  });
});
