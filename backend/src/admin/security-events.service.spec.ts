import { SecurityEventsService } from "./security-events.service";
import type { PrismaService } from "@/common/prisma/prisma.service";

describe("SecurityEventsService", () => {
  it("aggregates only identical account, IP, stage and reason within a minute", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-11-04T10:00:01Z"));
    try {
      const upsert = jest.fn().mockResolvedValue({});
      const service = new SecurityEventsService({
        adminAuditLog: { upsert },
      } as unknown as PrismaService);
      const event = {
        adminId: "a",
        email: "a@example.com",
        ip: null,
        reason: "ip_not_allowed" as const,
        stage: "request" as const,
      };
      await service.record(event);
      await service.record(event);
      await service.record({ ...event, ip: "192.0.2.1" });
      await service.record({ ...event, email: "b@example.com" });
      jest.advanceTimersByTime(60_000);
      await service.record(event);
      const keys = upsert.mock.calls.map(([arg]) => arg.where.aggregateKey);
      expect(keys[0]).toBe(keys[1]);
      expect(new Set([keys[0], keys[2], keys[3], keys[4]]).size).toBe(4);
      expect(upsert.mock.calls[0][0].update.eventCount).toEqual({
        increment: 1,
      });
      expect(upsert.mock.calls[0][0].create.details.ip).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not propagate audit write failures", async () => {
    const service = new SecurityEventsService({
      adminAuditLog: {
        upsert: jest.fn().mockRejectedValue(new Error("offline")),
      },
    } as unknown as PrismaService);
    await expect(
      service.record({
        adminId: "a",
        email: "a@example.com",
        ip: null,
        reason: "ip_not_allowed",
        stage: "request",
      }),
    ).resolves.toBeUndefined();
  });
});
