import type { PrismaService } from "@/common/prisma/prisma.service";
import { BoardsService } from "./boards.service";

/** TASK-101: the board list must not run a per-board card count. */
describe("BoardsService.listBoards", () => {
  it("counts cards in a constant number of queries", async () => {
    const memberships = [
      {
        boardId: "b1",
        role: "ADMIN",
        board: {
          id: "b1",
          title: "A",
          archivedAt: null,
          _count: { columns: 2 },
        },
      },
      {
        boardId: "b2",
        role: "MEMBER",
        board: {
          id: "b2",
          title: "B",
          archivedAt: null,
          _count: { columns: 1 },
        },
      },
    ];
    const count = jest.fn();
    const groupBy = jest.fn().mockResolvedValue([
      { columnId: "c1", _count: { _all: 3 } },
      { columnId: "c2", _count: { _all: 2 } },
    ]);
    const prisma = {
      boardMember: { findMany: jest.fn().mockResolvedValue(memberships) },
      card: { groupBy, count },
      column: {
        findMany: jest.fn().mockResolvedValue([
          { id: "c1", boardId: "b1" },
          { id: "c2", boardId: "b2" },
        ]),
      },
    } as unknown as PrismaService;

    const service = new BoardsService(prisma, {} as never, {} as never);
    const summaries = await service.listBoards("u1");

    expect(count).not.toHaveBeenCalled();
    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(summaries.map((summary) => summary.counters.cards)).toEqual([3, 2]);
  });
});
