import { DemoService } from "./demo.service";

describe("DemoService membership provisioning", () => {
  it("upserts every demo agent under all their user locks", async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const run = jest.fn(
      async (
        _boardId: string,
        fn: (client: unknown) => Promise<unknown>,
        _pause?: unknown,
        _options?: unknown,
      ) => fn({ boardMember: { upsert } }),
    );
    const service: {
      provisionMemberships: (
        boardId: string,
        userIds: readonly string[],
      ) => Promise<void>;
    } = Object.create(DemoService.prototype);
    (service as unknown as { boardWrite: unknown }).boardWrite = { run };

    await service.provisionMemberships("board-1", ["demo-a", "demo-b"]);

    // Both the newly created and the pre-existing board path use this method,
    // so every agent key is held before the board lock.
    expect(run).toHaveBeenCalledWith(
      "board-1",
      expect.any(Function),
      undefined,
      { lockUserIds: ["demo-a", "demo-b"] },
    );
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledWith({
      where: { boardId_userId: { boardId: "board-1", userId: "demo-a" } },
      create: expect.objectContaining({ acceptedAt: expect.any(Date) }),
      update: expect.objectContaining({ acceptedAt: expect.any(Date) }),
    });
  });
});
