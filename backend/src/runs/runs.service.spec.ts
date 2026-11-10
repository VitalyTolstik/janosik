import { ConflictException } from "@nestjs/common";
import { Role } from "@prisma/client";
import type { AgentRun } from "@prisma/client";
import type { CommandDeltaEntry } from "@janosik/shared";
import type { AuthPrincipal } from "@/auth/auth-principal";
import type { CommandsService } from "@/commands/commands.service";
import type { PrismaService } from "@/common/prisma/prisma.service";
import { RunsService } from "./runs.service";

/**
 * TASK-166.7: the revert pre-flight runs outside the board lock, so the
 * service passes a guard to `applyBatch` that re-runs the conflict analysis
 * under the lock. This unit test proves the guard is wired and that a version
 * changed between the two reads refuses the revert.
 */
describe("RunsService revert TOCTOU guard", () => {
  const run = {
    id: "run-1",
    boardId: "b1",
    apiTokenId: "tok-1",
    agentSessionId: null,
    actorId: "u1",
    kind: "batch",
    status: "applied",
    clientRunId: null,
    planHash: null,
    approvalId: null,
    commandCount: 1,
    firstSeq: 1n,
    lastSeq: 1n,
    revertsRunId: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    appliedAt: new Date("2026-01-01T00:00:00Z"),
    revertedAt: null,
  } as AgentRun;

  const command = {
    seq: 1,
    action: {
      type: "UPDATE_CARD",
      boardId: "b1",
      at: 1,
      cardId: "c1",
      title: "run title",
    },
    actorId: "u1",
    commandId: "cmd-1",
    touches: ["card:c1"],
  } as unknown as CommandDeltaEntry;

  const preimage = {
    schemaVersion: 1,
    boardVersion: 1,
    entities: [
      {
        touch: "card:c1",
        id: "c1",
        exists: true,
        version: 0,
        snapshot: { id: "c1", title: "old" },
        postVersion: 1,
        postDeletedAt: null,
      },
    ],
    inverse: {
      type: "UPDATE_CARD",
      boardId: "b1",
      at: 1,
      cardId: "c1",
      title: "old",
      description: "",
      inverse: true,
      boardUpdatedAt: 1,
    },
  };

  function prismaMock(): PrismaService {
    return {
      agentRun: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(run),
      },
      commandPreimage: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ commandId: "cmd-1", data: preimage }]),
      },
      card: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: "c1", version: 1, deletedAt: null }]),
      },
      board: { findMany: jest.fn().mockResolvedValue([]) },
      column: { findMany: jest.fn().mockResolvedValue([]) },
      label: { findMany: jest.fn().mockResolvedValue([]) },
      checklist: { findMany: jest.fn().mockResolvedValue([]) },
      checklistItem: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
  }

  it("re-runs the conflict check under the lock and refuses a later write", async () => {
    const prisma = prismaMock();
    let guardRan = false;
    // The fake transaction sees the card after a concurrent writer bumped it.
    const tx = {
      agentRun: {
        findFirst: jest.fn().mockResolvedValue({ status: "applied" }),
      },
      commandPreimage: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ commandId: "cmd-1", data: preimage }]),
      },
      card: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: "c1", version: 2, deletedAt: null }]),
      },
      board: { findMany: jest.fn().mockResolvedValue([]) },
      column: { findMany: jest.fn().mockResolvedValue([]) },
      label: { findMany: jest.fn().mockResolvedValue([]) },
      checklist: { findMany: jest.fn().mockResolvedValue([]) },
      checklistItem: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const commands = {
      deltaSince: jest.fn().mockResolvedValue({
        entries: [command],
        resync: false,
      }),
      applyBatch: jest.fn(
        async (
          _boardId: string,
          _actorId: string,
          _dtos: unknown,
          options: { guard?: (value: unknown) => Promise<void> },
        ) => {
          expect(options.guard).toBeDefined();
          guardRan = true;
          await options.guard!(tx);
          throw new Error("guard should have refused the revert");
        },
      ),
    };
    const service = new RunsService(
      prisma,
      commands as unknown as CommandsService,
      { publish: jest.fn() } as never,
      { record: jest.fn() } as never,
    );

    const error = await service
      .revert(
        "b1",
        "run-1",
        "u1",
        Role.ADMIN,
        { via: "jwt" } as AuthPrincipal,
        { commandId: "revert-1" },
      )
      .catch((reason: unknown) => reason);

    expect(guardRan).toBe(true);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: "run_conflict",
      details: {
        conflicts: [
          {
            touch: "card:c1",
            expectedVersion: 1,
            currentVersion: 2,
            reason: "version_changed",
          },
        ],
      },
    });
  });
});
