import type { PrismaService } from "@/common/prisma/prisma.service";
import { CommandsService } from "./commands.service";

/** TASK-84: the delta catch-up is bounded. */
describe("CommandsService.listSince", () => {
  it("caps the query so a since=0 catch-up cannot pull the whole log", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { command: { findMany } } as unknown as PrismaService;
    const service = new CommandsService(prisma, {} as never, {} as never);

    await service.listSince("board-1", 0);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5_000, orderBy: { seq: "asc" } }),
    );
  });
});
