import type { Prisma } from "@prisma/client";
import { revokeApiTokens } from "./token-revocation";

type Tx = Prisma.TransactionClient;

function claim(boardId: string) {
  return { column: { boardId } };
}

function txDouble(options: {
  tokens: Array<{ id: string; userId: string; boardId: string | null }>;
  memberships?: Array<{ boardId: string }>;
  claimBatches?: Array<Array<ReturnType<typeof claim>>>;
}) {
  let claimsRead = 0;
  const batches = options.claimBatches ?? [[]];
  const tx = {
    apiToken: {
      findMany: jest.fn().mockResolvedValue(options.tokens),
      updateMany: jest.fn().mockResolvedValue({ count: options.tokens.length }),
    },
    boardMember: {
      findMany: jest.fn().mockResolvedValue(options.memberships ?? []),
    },
    card: {
      findMany: jest.fn().mockImplementation(() => {
        const batch = batches[Math.min(claimsRead, batches.length - 1)] ?? [];
        claimsRead += 1;
        return Promise.resolve(batch);
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    agentSession: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    approvalRequest: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  return tx as unknown as Tx & {
    card: { findMany: jest.Mock; updateMany: jest.Mock };
    $executeRaw: jest.Mock;
  };
}

function lockedBoards(tx: ReturnType<typeof txDouble>): string[] {
  return tx.$executeRaw.mock.calls.map((call) => call[1] as string);
}

describe("revokeApiTokens board locks", () => {
  it("locks an unscoped token's membership boards even without a claim", async () => {
    const tx = txDouble({
      tokens: [{ id: "token-1", userId: "user-1", boardId: null }],
      memberships: [{ boardId: "board-b" }, { boardId: "board-a" }],
    });

    await revokeApiTokens(tx, { id: "token-1" });

    expect(lockedBoards(tx)).toEqual(["board-a", "board-b"]);
    expect(tx.boardMember.findMany).toHaveBeenCalledWith({
      where: { userId: { in: ["user-1"] }, acceptedAt: { not: null } },
      select: { boardId: true },
    });
    // Every lock must be in place before the first Card write.
    const lastLock = Math.max(...tx.$executeRaw.mock.invocationCallOrder);
    expect(tx.card.updateMany.mock.invocationCallOrder[0]).toBeGreaterThan(
      lastLock,
    );
  });

  it("locks the board a scoped token is bound to", async () => {
    const tx = txDouble({
      tokens: [{ id: "token-1", userId: "user-1", boardId: "board-a" }],
    });

    await revokeApiTokens(tx, { id: "token-1" });

    expect(lockedBoards(tx)).toEqual(["board-a"]);
    expect(tx.boardMember.findMany).not.toHaveBeenCalled();
  });

  it("adds a claim board discovered after the first lock pass", async () => {
    const tx = txDouble({
      tokens: [{ id: "token-1", userId: "user-1", boardId: "board-a" }],
      claimBatches: [[], [claim("board-z")], [claim("board-z")]],
    });

    await revokeApiTokens(tx, { id: "token-1" });

    expect(lockedBoards(tx)).toEqual(["board-a", "board-z"]);
  });
});
