import type { PrismaService } from "@/common/prisma/prisma.service";
import { COMMAND_DELTA_MAX, CommandsService } from "./commands.service";

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
