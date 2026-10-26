import type { Prisma } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  BOARD_WRITE_MAX_ATTEMPTS,
  BoardWriteService,
  isTransientConflict,
} from "./board-write.service";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A deferred Prisma double whose `$transaction` runs the callback at once. */
function fakePrisma() {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
  } as unknown as Prisma.TransactionClient;
  const prisma = {
    $transaction: jest.fn(
      async <T>(fn: (client: Prisma.TransactionClient) => Promise<T>) => fn(tx),
    ),
  };
  return { prisma, tx };
}

function service(prisma: unknown) {
  return new BoardWriteService(prisma as PrismaService);
}

describe("isTransientConflict", () => {
  it("treats Prisma's write-conflict code P2034 as retryable", () => {
    expect(isTransientConflict({ code: "P2034" })).toBe(true);
  });

  it("reads the SQLSTATE out of a raw-query failure (P2010)", () => {
    expect(
      isTransientConflict({ code: "P2010", meta: { code: "40P01" } }),
    ).toBe(true);
    expect(
      isTransientConflict({ code: "P2010", meta: { code: "40001" } }),
    ).toBe(true);
    expect(
      isTransientConflict({ code: "P2010", meta: { code: "23505" } }),
    ).toBe(false);
  });

  it("accepts a bare SQLSTATE and a deadlock message", () => {
    expect(isTransientConflict({ code: "40P01" })).toBe(true);
    expect(isTransientConflict(new Error("ERROR: deadlock detected"))).toBe(
      true,
    );
    expect(
      isTransientConflict(new Error("could not serialize access due to ...")),
    ).toBe(true);
  });

  it("ignores everything else", () => {
    expect(isTransientConflict({ code: "P2002" })).toBe(false);
    expect(isTransientConflict(new Error("boom"))).toBe(false);
    expect(isTransientConflict(null)).toBe(false);
  });
});

describe("BoardWriteService", () => {
  it("takes the per-board advisory lock before running the body", async () => {
    const { prisma, tx } = fakePrisma();
    const order: string[] = [];
    tx.$executeRaw = jest.fn(async () => {
      order.push("lock");
      return 1;
    }) as unknown as typeof tx.$executeRaw;

    await service(prisma).run("board-1", async () => {
      order.push("body");
      return "ok";
    });

    expect(order).toEqual(["lock", "body"]);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("replays a transaction that lost a race, then succeeds", async () => {
    const { prisma } = fakePrisma();
    let calls = 0;
    prisma.$transaction = jest.fn(
      async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
        calls += 1;
        if (calls < 3) {
          throw Object.assign(new Error("deadlock"), {
            code: "P2010",
            meta: { code: "40P01" },
          });
        }
        return fn({
          $executeRaw: jest.fn(),
        } as unknown as Prisma.TransactionClient);
      },
    );

    const result = await service(prisma).run("board-1", async () => "done");
    expect(result).toBe("done");
    expect(calls).toBe(3);
  });

  it("gives up after the attempt budget", async () => {
    const { prisma } = fakePrisma();
    let calls = 0;
    prisma.$transaction = jest.fn(async () => {
      calls += 1;
      throw Object.assign(new Error("deadlock"), { code: "P2034" });
    }) as unknown as typeof prisma.$transaction;

    await expect(
      service(prisma).run("board-1", async () => "x"),
    ).rejects.toThrow("deadlock");
    expect(calls).toBe(BOARD_WRITE_MAX_ATTEMPTS);
  });

  it("does not retry a non-transient failure", async () => {
    const { prisma } = fakePrisma();
    let calls = 0;
    prisma.$transaction = jest.fn(async () => {
      calls += 1;
      throw Object.assign(new Error("bad input"), { code: "P2002" });
    }) as unknown as typeof prisma.$transaction;

    await expect(
      service(prisma).run("board-1", async () => "x"),
    ).rejects.toThrow("bad input");
    expect(calls).toBe(1);
  });

  it("serializes writers of the same board", async () => {
    const order: string[] = [];
    const svc = service(fakePrisma().prisma);

    await Promise.all([
      svc.run("board-1", async () => {
        order.push("a-start");
        await delay(25);
        order.push("a-end");
      }),
      svc.run("board-1", async () => {
        order.push("b");
      }),
    ]);

    expect(order).toEqual(["a-start", "a-end", "b"]);
  });

  it("lets different boards run concurrently", async () => {
    const svc = service(fakePrisma().prisma);
    let live = 0;
    let peak = 0;
    const body = async () => {
      live += 1;
      peak = Math.max(peak, live);
      await delay(25);
      live -= 1;
    };

    await Promise.all([svc.run("board-1", body), svc.run("board-2", body)]);
    expect(peak).toBe(2);
  });

  it("keeps the queue going after a failing writer", async () => {
    const svc = service(fakePrisma().prisma);
    const first = svc.run("board-1", async () => {
      throw new Error("first failed");
    });
    const second = svc.run("board-1", async () => "second ok");

    await expect(first).rejects.toThrow("first failed");
    await expect(second).resolves.toBe("second ok");
  });
});
