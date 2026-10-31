import { BadRequestException, PayloadTooLargeException } from "@nestjs/common";
import { MAX_COMMAND_BYTES } from "@janosik/shared";
import type { PrismaService } from "@/common/prisma/prisma.service";
import {
  COMMAND_DELTA_MAX,
  CommandsService,
  MAX_COMMAND_BYTES_INTERNAL,
} from "./commands.service";

const row = (seq: number) => ({
  id: `cmd-${seq}`,
  seq: BigInt(seq),
  actorId: "user-1",
  payload: { type: "RENAME_BOARD", title: `t${seq}`, at: 1 },
  touches: [],
});

function service(findMany: jest.Mock, findFirst = jest.fn()) {
  const prisma = {
    command: { findMany, findFirst },
  } as unknown as PrismaService;
  return new CommandsService(prisma, {} as never, {} as never);
}

/** TASK-84 / B-3: the delta catch-up is bounded and admits truncation. */
describe("CommandsService.deltaSince", () => {
  it("caps the query (one probe row past the cap) so since=0 cannot pull the whole log", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await service(findMany).listSince("board-1", 0);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: COMMAND_DELTA_MAX + 1,
        orderBy: { seq: "asc" },
      }),
    );
  });

  it("carries the commandId (the Command PK) on every entry", async () => {
    const findMany = jest.fn().mockResolvedValue([row(3)]);
    const delta = await service(findMany).deltaSince("board-1", 0);
    expect(delta).toEqual({
      resync: false,
      entries: [
        expect.objectContaining({
          seq: 3,
          commandId: "cmd-3",
          actorId: "user-1",
        }),
      ],
    });
  });

  it("flags resync and drops the partial page when the cap is hit", async () => {
    const findMany = jest.fn().mockResolvedValue([row(1), row(2), row(3)]);
    const delta = await service(findMany).deltaSince("board-1", 0, 2);
    expect(delta.resync).toBe(true);
    // The caller must re-read the snapshot; the page itself is the capped one.
    expect(delta.entries.map((e) => e.seq)).toEqual([1, 2]);
  });

  it("flags resync when the baseline seq was trimmed from the log", async () => {
    const findMany = jest.fn();
    const findFirst = jest.fn().mockResolvedValue(null);
    const delta = await service(findMany, findFirst).deltaSince("board-1", 42);
    expect(findFirst).toHaveBeenCalledWith({
      where: { boardId: "board-1", seq: BigInt(42) },
      select: { seq: true },
    });
    expect(delta).toEqual({ entries: [], resync: true });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("replays normally from a baseline still in the log", async () => {
    const findMany = jest.fn().mockResolvedValue([row(50)]);
    const findFirst = jest.fn().mockResolvedValue({ seq: BigInt(42) });
    const delta = await service(findMany, findFirst).deltaSince("board-1", 42);
    expect(delta.resync).toBe(false);
    expect(delta.entries.map((e) => e.seq)).toEqual([50]);
  });
});

/**
 * TASK-156 (item 17): `allowOversize` lifts the internal admin restore path
 * over the 2 MiB client cap — but not without a ceiling. Everything above
 * `MAX_COMMAND_BYTES_INTERNAL` is still a 413, so a `RESTORE_COLUMN` snapshot
 * can never push an unbounded payload into the `Command.action` JSONB row
 * and one SSE frame per subscriber.
 */
describe("CommandsService.apply size caps", () => {
  const actorId = "user-1";
  const boardId = "board-1";

  /** An UPDATE_CARD whose JSON encoding is exactly `bytes` bytes long. */
  const actionOfBytes = (bytes: number) => {
    const skeleton = {
      type: "UPDATE_CARD",
      cardId: "card-1",
      at: 1,
      description: "",
    };
    const overhead = Buffer.byteLength(JSON.stringify(skeleton), "utf8");
    expect(overhead).toBeLessThan(bytes);
    return { ...skeleton, description: "a".repeat(bytes - overhead) };
  };

  it("413s a client command one byte above MAX_COMMAND_BYTES", async () => {
    const svc = service(jest.fn());
    await expect(
      svc.apply(boardId, actorId, {
        commandId: "cmd-size",
        action: actionOfBytes(MAX_COMMAND_BYTES + 1),
      }),
    ).rejects.toThrow(PayloadTooLargeException);
  });

  it("still 413s a client command inside the bypass window without the bypass", async () => {
    // A mid-window payload the internal path may send — a client cannot.
    const svc = service(jest.fn());
    await expect(
      svc.apply(boardId, actorId, {
        commandId: "cmd-size",
        action: actionOfBytes(
          Math.floor((MAX_COMMAND_BYTES + MAX_COMMAND_BYTES_INTERNAL) / 2),
        ),
      }),
    ).rejects.toThrow(PayloadTooLargeException);
  });

  it("lets an internal restore at the internal cap past the size gate", async () => {
    // Exactly MAX_COMMAND_BYTES_INTERNAL passes the 413 gate. The next
    // guard answers instead — payload validation rejects the oversized
    // description with a 400, which proves the size check let it through
    // (a 413 here would mean the cap cut it off).
    const action = actionOfBytes(MAX_COMMAND_BYTES_INTERNAL);
    expect(Buffer.byteLength(JSON.stringify(action), "utf8")).toBe(
      MAX_COMMAND_BYTES_INTERNAL,
    );
    const svc = service(jest.fn());
    await expect(
      svc.apply(
        boardId,
        actorId,
        { commandId: "cmd-size", action },
        { allowOversize: true },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("413s an internal restore one byte above the internal cap", async () => {
    const svc = service(jest.fn());
    await expect(
      svc.apply(
        boardId,
        actorId,
        {
          commandId: "cmd-size",
          action: actionOfBytes(MAX_COMMAND_BYTES_INTERNAL + 1),
        },
        { allowOversize: true },
      ),
    ).rejects.toThrow(PayloadTooLargeException);
  });
});

/**
 * TASK-160: a batch validates every command before it takes the board lock,
 * so an oversized member is a cheap 413 — never megabytes serialized through
 * the board writer, and never a partial apply.
 */
describe("CommandsService.applyBatch size caps", () => {
  const actorId = "user-1";
  const boardId = "board-1";

  /** An `UPDATE_CARD` whose JSON encoding is exactly `bytes` bytes long. */
  const actionOfBytes = (bytes: number) => {
    const skeleton = {
      type: "UPDATE_CARD",
      cardId: "card-1",
      at: 1,
      description: "",
    };
    const overhead = Buffer.byteLength(JSON.stringify(skeleton), "utf8");
    return { ...skeleton, description: "a".repeat(bytes - overhead) };
  };

  it("413s the batch before the board lock when any member is oversized", async () => {
    const boardWrite = { run: jest.fn() };
    const prisma = {
      command: { findMany: jest.fn(), findFirst: jest.fn() },
    } as unknown as PrismaService;
    const svc = new CommandsService(prisma, boardWrite as never, {} as never);

    await expect(
      svc.applyBatch(boardId, actorId, [
        {
          commandId: "cmd-ok",
          action: { type: "RENAME_BOARD", title: "x", at: 1 },
        },
        {
          commandId: "cmd-big",
          action: actionOfBytes(MAX_COMMAND_BYTES + 1),
        },
      ]),
    ).rejects.toThrow(PayloadTooLargeException);
    // The board writer — the per-board queue and the advisory lock — was
    // never entered: the whole batch failed its cheap validation first.
    expect(boardWrite.run).not.toHaveBeenCalled();
  });
});
