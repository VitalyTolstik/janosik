import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Role } from "@prisma/client";
import type { AgentRun, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type {
  AgentRunDto,
  AgentRunKind,
  AgentRunStatus,
  BoardAction,
  CommandDeltaEntry,
  RevertConflictDto,
  RevertPreviewDto,
  RunDetailDto,
  RunSummaryDto,
} from "@janosik/shared";
import type { AuthPrincipal } from "@/auth/auth-principal";
import { PAT_FORBIDDEN_MESSAGE } from "@/auth/auth-principal";
import {
  CommandsService,
  COMMAND_DELTA_MAX,
} from "@/commands/commands.service";
import {
  isBoardLevelAction,
  readPreimageData,
  type PreimageData,
  type PreimageEntity,
} from "@/commands/run-preimage";
import { PrismaService } from "@/common/prisma/prisma.service";
import { SecurityAuditService } from "@/common/security-audit/security-audit.service";
import { RealtimeService } from "@/realtime/realtime.service";
import type { RevertRunDto, RunListQueryDto } from "./dto/run.dto";

/** Current row state used to compare a run's post-state with the board. */
interface CurrentState {
  version: number;
  deletedAt: number | null;
}

interface RunAnalysis {
  conflicts: RevertConflictDto[];
  inverses: BoardAction[];
  lastByTouch: Map<string, PreimageEntity>;
  currentByTouch: Map<string, CurrentState>;
}

function runToDto(row: AgentRun): AgentRunDto {
  return {
    id: row.id,
    boardId: row.boardId,
    apiTokenId: row.apiTokenId,
    agentSessionId: row.agentSessionId,
    actorId: row.actorId,
    kind: row.kind as AgentRunKind,
    status: row.status as AgentRunStatus,
    clientRunId: row.clientRunId,
    planHash: row.planHash,
    approvalId: row.approvalId,
    commandCount: row.commandCount,
    firstSeq: row.firstSeq === null ? null : Number(row.firstSeq),
    lastSeq: row.lastSeq === null ? null : Number(row.lastSeq),
    revertsRunId: row.revertsRunId,
    createdAt: row.createdAt.getTime(),
    appliedAt: row.appliedAt.getTime(),
    revertedAt: row.revertedAt === null ? null : row.revertedAt.getTime(),
  };
}

/** Strip the internal compensating action from a public pre-image read. */
function publicPreimage(data: PreimageData): Record<string, unknown> {
  const copy = { ...data } as Record<string, unknown>;
  delete copy.inverse;
  return copy;
}

/**
 * TASK-166.7 — run listing, detail reads and human-only rollback.
 *
 * A run is created by the command transport for a PAT batch, a single
 * destructive PAT command and the plan/apply seam. Rollback is deliberately
 * human-only (board ADMIN, browser JWT, D17); an agent can preview conflicts
 * but cannot apply a revert. The actual inverse commands travel through the
 * ordinary command log, so viewers see them on SSE and the browser's own
 * undo stack keeps working.
 */
@Injectable()
export class RunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commands: CommandsService,
    private readonly realtime: RealtimeService,
    private readonly securityAudit: SecurityAuditService,
  ) {}

  async list(
    boardId: string,
    query: RunListQueryDto,
  ): Promise<RunSummaryDto[]> {
    const limit = Math.min(query.limit ?? 50, 100);
    let cursor: { createdAt: Date; id: string } | null = null;
    if (query.cursor !== undefined && query.cursor !== "") {
      const row = await this.prisma.agentRun.findFirst({
        where: { id: query.cursor, boardId },
        select: { id: true, createdAt: true },
      });
      if (row === null) throw new NotFoundException("Run not found");
      cursor = row;
    }

    const rows = await this.prisma.agentRun.findMany({
      where: {
        boardId,
        ...(query.status !== undefined ? { status: query.status } : {}),
        ...(query.kind !== undefined ? { kind: query.kind } : {}),
        ...(query.apiTokenId !== undefined
          ? { apiTokenId: query.apiTokenId }
          : {}),
        ...(query.agentSessionId !== undefined
          ? { agentSessionId: query.agentSessionId }
          : {}),
        ...(query.clientRunId !== undefined
          ? { clientRunId: query.clientRunId }
          : {}),
        ...(query.from !== undefined || query.to !== undefined
          ? {
              createdAt: {
                ...(query.from !== undefined
                  ? { gte: new Date(query.from) }
                  : {}),
                ...(query.to !== undefined ? { lte: new Date(query.to) } : {}),
              },
            }
          : {}),
        ...(cursor !== null
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    return rows.map(runToDto);
  }

  async get(
    boardId: string,
    runId: string,
    role: Role,
    principal: AuthPrincipal | undefined,
  ): Promise<RunDetailDto> {
    const run = await this.load(boardId, runId);
    const commands = await this.commandEntries(boardId, runId);
    const fullDetail = principal?.via === "jwt" && role === Role.ADMIN;
    return {
      run: runToDto(run),
      commands,
      preimages: fullDetail ? await this.preimages(boardId, runId) : {},
    };
  }

  /**
   * Dry run (ADR §11.4): conflicts are visible to any board member; the diff
   * with snapshots only to a browser-session board ADMIN. Writes nothing.
   */
  async preview(
    boardId: string,
    runId: string,
    role: Role,
    principal: AuthPrincipal | undefined,
  ): Promise<RevertPreviewDto> {
    const run = await this.load(boardId, runId);
    const commands = await this.commandEntries(boardId, runId);
    const stored = await this.preimages(boardId, runId);
    const analysis = await this.analyze(
      boardId,
      run,
      commands,
      await this.rawPreimages(boardId, runId),
    );
    const fullDetail = principal?.via === "jwt" && role === Role.ADMIN;
    return {
      dryRun: true,
      run: runToDto(run),
      conflicts: analysis.conflicts,
      canRevert:
        run.status === "applied" &&
        run.kind !== "revert" &&
        analysis.inverses.length > 0 &&
        analysis.conflicts.length === 0,
      ...(fullDetail ? { diff: this.diff(runId, analysis, stored) } : {}),
    };
  }

  /**
   * Apply a rollback. Browser-session board ADMIN only (D17): a PAT gets
   * `pat_forbidden`, a non-ADMIN member `scope_denied`. The inverse commands
   * run as one ordinary batch in a revert run; the original is marked
   * `reverted` in the same transaction.
   */
  async revert(
    boardId: string,
    runId: string,
    actorId: string,
    role: Role,
    principal: AuthPrincipal | undefined,
    dto: RevertRunDto,
  ): Promise<RunDetailDto> {
    if (principal?.via === "pat") {
      throw new ForbiddenException({
        message: PAT_FORBIDDEN_MESSAGE,
        code: "pat_forbidden",
      });
    }
    if (role !== Role.ADMIN) {
      throw new ForbiddenException({
        message: "Only a board ADMIN can revert a run",
        code: "scope_denied",
        requiredRoles: [Role.ADMIN],
      });
    }
    const commandId = dto.commandId;
    if (commandId === undefined || commandId.trim() === "") {
      throw new ConflictException({
        message: "A revert requires a commandId idempotency key",
        code: "run_conflict",
        reason: "command_id_required",
      });
    }

    // A retry after a committed revert returns the existing revert run.
    const replay = await this.prisma.agentRun.findUnique({
      where: { boardId_clientRunId: { boardId, clientRunId: commandId } },
    });
    if (replay !== null) {
      if (replay.kind === "revert" && replay.revertsRunId === runId) {
        return this.get(boardId, replay.id, role, principal);
      }
      throw this.conflict("clientRunId already used by another run");
    }

    const run = await this.load(boardId, runId);
    if (run.status !== "applied") {
      throw this.conflict(`Run is already ${run.status}`);
    }
    if (run.kind === "revert") {
      throw this.conflict("Reverting a revert is not supported");
    }

    const commands = await this.commandEntries(boardId, runId);
    const analysis = await this.analyze(
      boardId,
      run,
      commands,
      await this.rawPreimages(boardId, runId),
    );
    if (analysis.conflicts.length > 0) {
      throw this.conflict(
        "Run cannot be reverted without conflicts",
        analysis.conflicts,
      );
    }
    if (analysis.inverses.length === 0) {
      throw this.conflict("Run has no revertable commands");
    }

    const inverseCommands = analysis.inverses.map((action) => ({
      commandId: randomUUID(),
      action: action as unknown as Record<string, unknown>,
    }));

    // TOCTOU guard: the pre-flight analysis ran outside the board lock. This
    // runs again inside the revert transaction, after the advisory lock and
    // before any inverse command, so a write that landed in between is
    // refused instead of being overwritten.
    const revalidate = async (tx: Prisma.TransactionClient): Promise<void> => {
      const current = await tx.agentRun.findFirst({
        where: { id: runId, boardId },
        select: { status: true },
      });
      if (current === null) throw this.conflict("Run no longer exists");
      if (current.status !== "applied") {
        throw this.conflict(`Run is already ${current.status}`);
      }
      const currentCommands = await this.commandEntries(boardId, runId, tx);
      const currentPreimages = await this.rawPreimages(boardId, runId, tx);
      const guarded = await this.analyze(
        boardId,
        run,
        currentCommands,
        currentPreimages,
        tx,
      );
      if (guarded.conflicts.length > 0) {
        throw this.conflict(
          "Run cannot be reverted without conflicts",
          guarded.conflicts,
        );
      }
      if (guarded.inverses.length !== analysis.inverses.length) {
        throw this.conflict("Run changed while the revert was being prepared");
      }
    };

    let applied;
    try {
      applied = await this.commands.applyBatch(
        boardId,
        actorId,
        inverseCommands,
        {
          actorType: "human",
          actorRole: Role.ADMIN,
          guard: revalidate,
          run: {
            kind: "revert",
            clientRunId: commandId,
            revertsRunId: runId,
          },
          afterRun: async (tx, revertRunId, results) => {
            const changed = await tx.agentRun.updateMany({
              where: { id: runId, status: "applied" },
              data: { status: "reverted", revertedAt: new Date() },
            });
            if (changed.count === 0) {
              throw this.conflict("Run was reverted by another request");
            }
            await tx.activity.create({
              data: {
                boardId,
                type: "run_reverted",
                actorId,
                actorType: "human",
                runId: revertRunId,
                details: {
                  originalRunId: runId,
                  revertRunId,
                  commandCount: results.length,
                },
              },
            });
          },
        },
      );
    } catch (error) {
      // Two concurrent retries: the unique clientRunId is the one-time lock.
      if (
        typeof error === "object" &&
        error !== null &&
        (error as { code?: unknown }).code === "P2002"
      ) {
        const existing = await this.prisma.agentRun.findUnique({
          where: { boardId_clientRunId: { boardId, clientRunId: commandId } },
        });
        if (existing !== null && existing.kind === "revert") {
          return this.get(boardId, existing.id, role, principal);
        }
      }
      throw error;
    }

    const revertRunId = applied.runId;
    if (revertRunId === null) {
      throw new ServiceUnavailableException({
        message: "The revert transaction did not create its audit run",
        code: "run_conflict",
      });
    }

    await this.securityAudit.record({
      userId: actorId,
      actorId,
      actorType: "human",
      action: "run.reverted",
      targetType: "agent_run",
      targetId: runId,
      details: {
        boardId,
        originalRunId: runId,
        revertRunId,
        apiTokenId: run.apiTokenId,
        agentSessionId: run.agentSessionId,
        commandCount: commands.length,
      },
    });
    this.realtime.publish(boardId, {
      type: "run",
      op: "reverted",
      runId,
      revertRunId,
      at: Date.now(),
    });

    return this.get(boardId, revertRunId, role, principal);
  }

  private async load(boardId: string, runId: string): Promise<AgentRun> {
    const run = await this.prisma.agentRun.findFirst({
      where: { id: runId, boardId },
    });
    if (run === null) throw new NotFoundException("Run not found");
    return run;
  }

  private async commandEntries(
    boardId: string,
    runId: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<CommandDeltaEntry[]> {
    const delta = await this.commands.deltaSince(
      boardId,
      0,
      COMMAND_DELTA_MAX,
      { runId },
      client,
    );
    return delta.entries;
  }

  private async rawPreimages(
    boardId: string,
    runId: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<Map<string, PreimageData>> {
    const rows = await client.commandPreimage.findMany({
      where: { boardId, runId },
      select: { commandId: true, data: true },
    });
    const map = new Map<string, PreimageData>();
    for (const row of rows) {
      const data = readPreimageData(row.data);
      if (data !== null) map.set(row.commandId, data);
    }
    return map;
  }

  private async preimages(
    boardId: string,
    runId: string,
  ): Promise<Record<string, unknown>> {
    const rows = await this.prisma.commandPreimage.findMany({
      where: { boardId, runId },
      orderBy: { createdAt: "asc" },
      select: { commandId: true, data: true },
    });
    const result: Record<string, unknown> = {};
    for (const row of rows) {
      const data = readPreimageData(row.data);
      result[row.commandId] = data === null ? row.data : publicPreimage(data);
    }
    return result;
  }

  /**
   * Compare the run's recorded post-state with the current rows. Any touched
   * entity changed after the run (or was deleted/restored) is a conflict and
   * blocks the whole rollback (ADR §11.4). Intermediate writes *inside* the
   * run are unwound in reverse order and are not conflicts.
   */
  private async analyze(
    boardId: string,
    run: AgentRun,
    commands: CommandDeltaEntry[],
    preimages: Map<string, PreimageData>,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<RunAnalysis> {
    if (commands.length === 0) {
      throw this.expired();
    }
    for (const command of commands) {
      if (!preimages.has(command.commandId ?? "")) throw this.expired();
    }

    const boardTouch = `board:${boardId}`;
    const boardChanged = commands.some(
      (command) =>
        command.commandId !== undefined && isBoardLevelAction(command.action),
    );
    const lastByTouch = new Map<string, PreimageEntity>();
    const conflicts: RevertConflictDto[] = [];
    const inverses: BoardAction[] = [];

    for (const command of commands) {
      const data = preimages.get(command.commandId ?? "");
      if (data === undefined) throw this.expired();
      for (const entity of data.entities) {
        if (!boardChanged && entity.touch === boardTouch) continue;
        lastByTouch.set(entity.touch, entity);
      }
    }

    for (const command of [...commands].reverse()) {
      const data = preimages.get(command.commandId ?? "");
      if (data === undefined) throw this.expired();
      const hasEntity = data.entities.some(
        (entity) => entity.touch !== boardTouch || boardChanged,
      );
      if (data.inverse === undefined || data.inverse === null) {
        if (hasEntity) {
          conflicts.push({
            touch: `command:${command.commandId ?? ""}`,
            expectedVersion: 0,
            currentVersion: 0,
            reason: "not_revertable",
          });
        }
        continue;
      }
      inverses.push(data.inverse);
    }

    const currentByTouch = await this.currentStates(
      boardId,
      [...lastByTouch.keys()],
      client,
    );
    for (const [touch, expected] of lastByTouch) {
      const current = currentByTouch.get(touch) ?? null;
      const expectedVersion = expected.postVersion ?? 0;
      const currentVersion = current?.version ?? 0;
      const expectedDeletedAt = expected.postDeletedAt ?? null;
      const currentDeletedAt = current?.deletedAt ?? null;
      if (expectedDeletedAt !== currentDeletedAt) {
        conflicts.push({
          touch,
          expectedVersion,
          currentVersion,
          reason:
            expectedDeletedAt === null
              ? "deleted"
              : currentDeletedAt === null
                ? "restored"
                : "deleted_at_changed",
        });
      } else if (expectedVersion !== currentVersion) {
        conflicts.push({
          touch,
          expectedVersion,
          currentVersion,
          reason:
            expectedVersion === 0
              ? "recreated"
              : current === null
                ? "missing"
                : "version_changed",
        });
      }
    }
    conflicts.sort((a, b) => a.touch.localeCompare(b.touch));

    return { conflicts, inverses, lastByTouch, currentByTouch };
  }

  private async currentStates(
    boardId: string,
    touches: string[],
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<Map<string, CurrentState>> {
    const idsFor = (prefix: string) =>
      touches
        .filter((label) => label.startsWith(`${prefix}:`))
        .map((label) => label.slice(prefix.length + 1));
    const result = new Map<string, CurrentState>();
    const put = (
      prefix: string,
      rows: { id: string; version: number; deletedAt: Date | null }[],
    ) => {
      for (const row of rows) {
        result.set(`${prefix}:${row.id}`, {
          version: row.version,
          deletedAt: row.deletedAt === null ? null : row.deletedAt.getTime(),
        });
      }
    };

    const [boards, columns, cards, labels, checklists, items] =
      await Promise.all([
        idsFor("board").length === 0
          ? Promise.resolve([])
          : client.board.findMany({
              // A soft-deleted board is still a row; its `deletedAt` is part
              // of the conflict comparison, not "entity missing".
              where: { id: { in: idsFor("board") } },
              select: { id: true, version: true, deletedAt: true },
            }),
        idsFor("column").length === 0
          ? Promise.resolve([])
          : client.column.findMany({
              where: { id: { in: idsFor("column") } },
              select: { id: true, version: true, deletedAt: true },
            }),
        idsFor("card").length === 0
          ? Promise.resolve([])
          : client.card.findMany({
              where: { id: { in: idsFor("card") } },
              select: { id: true, version: true, deletedAt: true },
            }),
        idsFor("label").length === 0
          ? Promise.resolve([])
          : client.label.findMany({
              where: { id: { in: idsFor("label") } },
              select: { id: true, version: true, deletedAt: true },
            }),
        idsFor("checklist").length === 0
          ? Promise.resolve([])
          : client.checklist.findMany({
              where: { id: { in: idsFor("checklist") } },
              select: { id: true, version: true, deletedAt: true },
            }),
        idsFor("checklistItem").length === 0
          ? Promise.resolve([])
          : client.checklistItem.findMany({
              where: { id: { in: idsFor("checklistItem") } },
              select: { id: true, version: true, deletedAt: true },
            }),
      ]);
    put("board", boards);
    put("column", columns);
    put("card", cards);
    put("label", labels);
    put("checklist", checklists);
    put("checklistItem", items);
    return result;
  }

  private diff(
    runId: string,
    analysis: RunAnalysis,
    preimages: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      schemaVersion: 1,
      runId,
      commands: analysis.inverses.map((action) => ({ action })),
      entities: [...analysis.lastByTouch.entries()].map(
        ([touch, expected]) => ({
          touch,
          before: expected.snapshot,
          postVersion: expected.postVersion,
          postDeletedAt: expected.postDeletedAt,
          currentVersion: analysis.currentByTouch.get(touch)?.version ?? null,
        }),
      ),
      preimages,
    };
  }

  private conflict(
    message: string,
    conflicts: RevertConflictDto[] = [],
  ): ConflictException {
    return new ConflictException({
      message,
      code: "run_conflict",
      retryable: false,
      ...(conflicts.length > 0 ? { conflicts, details: { conflicts } } : {}),
    });
  }

  private expired(): ConflictException {
    return new ConflictException({
      message: "Run or its pre-images were removed by retention",
      code: "run_expired",
      retryable: false,
    });
  }
}
