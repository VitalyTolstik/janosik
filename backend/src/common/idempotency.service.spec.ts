import { BadRequestException, ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { PrismaService } from "@/common/prisma/prisma.service";
import {
  canonicalJson,
  IdempotencyService,
  normalizeIdempotencyKey,
} from "./idempotency.service";
import { beforeWrite } from "./rollback-certainty";

function duplicateKeyError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("duplicate", {
    code: "P2002",
    clientVersion: "6.16.2",
    meta: { target: ["scope", "actorKey", "key"] },
  });
}

function makePrisma() {
  return {
    idempotencyRecord: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
  };
}

const base = {
  scope: "create_board" as const,
  key: "key-1",
  actorKey: "user:u1",
  requestHash: "hash-1",
};

describe("IdempotencyService (TASK-166.4)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("passes through without a key", async () => {
    const prisma = makePrisma();
    const service = new IdempotencyService(prisma as unknown as PrismaService);
    const run = jest.fn().mockResolvedValue({ body: { id: "b1" } });
    await expect(
      service.run({ ...base, key: undefined, run }),
    ).resolves.toEqual({
      body: { id: "b1" },
      resourceId: null,
      replayed: false,
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(prisma.idempotencyRecord.create).not.toHaveBeenCalled();
  });

  it("stores the result after a successful run", async () => {
    const prisma = makePrisma();
    prisma.idempotencyRecord.create.mockResolvedValue({ id: "rec-1" });
    const service = new IdempotencyService(prisma as unknown as PrismaService);
    const outcome = await service.run({
      ...base,
      run: async () => ({ body: { id: "b1" }, status: 201, resourceId: "b1" }),
    });
    expect(outcome).toEqual({
      body: { id: "b1" },
      resourceId: "b1",
      replayed: false,
    });
    expect(prisma.idempotencyRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rec-1" },
        data: expect.objectContaining({
          status: "completed",
          responseStatus: 201,
          resourceId: "b1",
        }),
      }),
    );
  });

  it("replays the stored body for the same key and hash", async () => {
    const prisma = makePrisma();
    prisma.idempotencyRecord.create.mockRejectedValue(duplicateKeyError());
    prisma.idempotencyRecord.findUnique.mockResolvedValue({
      status: "completed",
      requestHash: "hash-1",
      responseBody: { id: "b1" },
      resourceId: "b1",
    });
    const service = new IdempotencyService(prisma as unknown as PrismaService);
    const run = jest.fn();
    await expect(service.run({ ...base, run })).resolves.toEqual({
      body: { id: "b1" },
      resourceId: "b1",
      replayed: true,
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses the same key with another body", async () => {
    const prisma = makePrisma();
    prisma.idempotencyRecord.create.mockRejectedValue(duplicateKeyError());
    prisma.idempotencyRecord.findUnique.mockResolvedValue({
      status: "completed",
      requestHash: "other-hash",
      responseBody: {},
      resourceId: null,
    });
    const service = new IdempotencyService(prisma as unknown as PrismaService);
    const error = await service
      .run({ ...base, run: jest.fn() })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: "idempotency_conflict",
      key: "key-1",
      retryable: false,
    });
  });

  it("answers a concurrent retry as retryable in-progress", async () => {
    const prisma = makePrisma();
    prisma.idempotencyRecord.create.mockRejectedValue(duplicateKeyError());
    prisma.idempotencyRecord.findUnique.mockResolvedValue({
      status: "in_progress",
      requestHash: "hash-1",
      responseBody: null,
      resourceId: null,
    });
    const service = new IdempotencyService(prisma as unknown as PrismaService);
    const error = await service
      .run({ ...base, run: jest.fn() })
      .catch((caught: unknown) => caught);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: "idempotency_in_progress",
      retryable: true,
    });
  });

  it("keeps the record when storing the response fails after a commit", async () => {
    const prisma = makePrisma();
    prisma.idempotencyRecord.create.mockResolvedValue({ id: "rec-1" });
    prisma.idempotencyRecord.update.mockRejectedValue(new Error("db hiccup"));
    const service = new IdempotencyService(prisma as unknown as PrismaService);
    const outcome = await service.run({
      ...base,
      run: async () => ({ body: { id: "b1" }, status: 201, resourceId: "b1" }),
    });
    expect(outcome).toMatchObject({ replayed: false, resourceId: "b1" });
    // Deleting here would allow a retry to duplicate the committed write.
    expect(prisma.idempotencyRecord.delete).not.toHaveBeenCalled();
  });

  it("releases the key when the write fails", async () => {
    const prisma = makePrisma();
    prisma.idempotencyRecord.create.mockResolvedValue({ id: "rec-1" });
    const service = new IdempotencyService(prisma as unknown as PrismaService);
    await expect(
      service.run({
        ...base,
        run: async () => {
          throw beforeWrite(new Error("write failed"));
        },
      }),
    ).rejects.toThrow("write failed");
    expect(prisma.idempotencyRecord.delete).toHaveBeenCalledWith({
      where: { id: "rec-1" },
    });
  });

  it("retains the key when the outcome may have committed", async () => {
    const prisma = makePrisma();
    prisma.idempotencyRecord.create.mockResolvedValue({ id: "rec-1" });
    const service = new IdempotencyService(prisma as unknown as PrismaService);
    await expect(
      service.run({
        ...base,
        run: async () => {
          throw new Error("uncertain result");
        },
      }),
    ).rejects.toThrow("uncertain result");
    expect(prisma.idempotencyRecord.delete).not.toHaveBeenCalled();
  });
});

describe("idempotency helpers", () => {
  it("rejects an unsafe Idempotency-Key", () => {
    expect(() => normalizeIdempotencyKey("a b")).toThrow(BadRequestException);
    expect(() => normalizeIdempotencyKey("short")).toThrow(BadRequestException);
    expect(() => normalizeIdempotencyKey("dots.not-allowed")).toThrow(
      BadRequestException,
    );
    expect(normalizeIdempotencyKey("  ")).toBeUndefined();
    expect(normalizeIdempotencyKey(" a_b-c_d-e ")).toBe("a_b-c_d-e");
  });

  it("canonicalizes object keys for a stable hash", () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
  });

  it("normalizes Dates instead of collapsing them to an empty object", () => {
    const date = new Date("2026-11-10T12:00:00.000Z");
    expect(canonicalJson({ at: date })).toBe(
      canonicalJson({ at: "2026-11-10T12:00:00.000Z" }),
    );
    expect(canonicalJson({ at: date })).not.toBe(canonicalJson({ at: {} }));
  });
});
