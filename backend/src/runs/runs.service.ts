import {
  BadRequestException,
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
import { env } from "@/config/env";
import { OpsSettingsService } from "@/ops/ops-settings.service";
import { RealtimeService } from "@/realtime/realtime.service";
import { loadCommandSummaries } from "./run-summary";
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

export function runToDto(row: AgentRun): AgentRunDto {
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

interface RunAttribution {
  tokenNames: Map<string, string>;
  actorNames: Map<string, string>;
  sessionNames: Map<string, string>;
}

/** Human names for run attribution; board-scoped and read-only. */
async function loadRunAttribution(
  prisma: PrismaService,
  rows: readonly AgentRun[],
): Promise<RunAttribution> {
  const tokenIds = [
    ...new Set(
      rows
        .map((row) => row.apiTokenId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const actorIds = [...new Set(rows.map((row) => row.actorId))];
  const sessionIds = [
    ...new Set(
      rows
        .map((row) => row.agentSessionId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const [tokens, actors, sessions] = await Promise.all([
    tokenIds.length === 0
      ? Promise.resolve([])
      : prisma.apiToken.findMany({
          where: { id: { in: tokenIds } },
          select: { id: true, name: true },
        }),
    actorIds.length === 0
      ? Promise.resolve([])
      : prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, displayName: true },
        }),
    sessionIds.length === 0
      ? Promise.resolve([])
      : prisma.agentSession.findMany({
          where: { id: { in: sessionIds } },
          select: { id: true, name: true, clientName: true },
        }),
  ]);
  return {
    tokenNames: new Map(tokens.map((row) => [row.id, row.name])),
    actorNames: new Map(
      actors.map((row) => [row.id, row.displayName ?? row.id]),
    ),
    sessionNames: new Map(
      sessions.map((row) => [row.id, row.name ?? row.clientName ?? row.id]),
    ),
  };
}

function withRunAttribution(
  dto: AgentRunDto,
  names: RunAttribution,
): AgentRunDto {
  return {
    ...dto,
    tokenName:
      dto.apiTokenId === null
        ? null
        : (names.tokenNames.get(dto.apiTokenId) ?? null),
    actorName: names.actorNames.get(dto.actorId) ?? null,
    sessionName:
      dto.agentSessionId === null
        ? null
        : (names.sessionNames.get(dto.agentSessionId) ?? null),
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
    private readonly ops: OpsSettingsService,
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
    const [summaries, attribution] = await Promise.all([
      loadCommandSummaries(
        this.prisma,
        rows.map((row) => row.id),
      ),
      loadRunAttribution(this.prisma, rows),
    ]);
    return rows.map((row) => {
      const summary = summaries.get(row.id);
      return {
        ...withRunAttribution(runToDto(row), attribution),
        ...(summary === undefined ? {} : { commandSummary: summary }),
      };
    });
  }

  async get(
    boardId: string,
    runId: string,
    role: Role,
    principal: AuthPrincipal | undefined,
  ): Promise<RunDetailDto> {
    const run = await this.load(boardId, runId);
    const commands = await this.commandEntries(boardId, runId);
    const summaries = await loadCommandSummaries(this.prisma, [run.id]);
    const summary = summaries.get(run.id);
    const attribution = await loadRunAttribution(this.prisma, [run]);
    const fullDetail = principal?.via === "jwt" && role === Role.ADMIN;
    return {
      run: {
        ...withRunAttribution(runToDto(run), attribution),
        ...(summary === undefined ? {} : { commandSummary: summary }),
      },
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
    const commandId = dto.commandId?.trim();
    if (commandId === undefined || commandId === "") {
      // L21: a retry key is a request-shape error, not a state conflict.
      throw new BadRequestException({
        message: "A revert requires a commandId idempotency key",
        code: "validation_failed",
        field: "commandId",
        reason: "command_id_required",
      });
    }

    const currentVersion = await this.commands.latestSeq(boardId);

    // A retry after a committed revert returns the existing revert run — but
    // only when that run is *this* run's rollback. A key reused for another
    // run is a conflict, never a handle to the wrong audit run.
    const replay = await this.prisma.agentRun.findUnique({
      where: { boardId_clientRunId: { boardId, clientRunId: commandId } },
    });
    if (replay !== null) {
      if (replay.kind === "revert" && replay.revertsRunId === runId) {
        return this.get(boardId, replay.id, role, principal);
      }
      throw this.conflict("clientRunId already used by another run", [], {
        runId,
        currentVersion,
      });
    }

    // The preflight itself can lose the same race: a concurrent request with
    // this key may commit between the replay lookup above and these reads.
    // On any preflight `run_conflict`, reconcile once more against the
    // winner before returning an error next to a reverted run.
    let run: AgentRun;
    let commands: CommandDeltaEntry[];
    let analysis: RunAnalysis;
    try {
      run = await this.load(boardId, runId);
      if (run.status !== "applied") {
        throw this.conflict(`Run is already ${run.status}`, [], {
          runId,
          currentVersion,
        });
      }
      if (run.kind === "revert") {
        throw this.conflict("Reverting a revert is not supported", [], {
          runId,
          currentVersion,
        });
      }

      commands = await this.commandEntries(boardId, runId);
      analysis = await this.analyze(
        boardId,
        run,
        commands,
        await this.rawPreimages(boardId, runId),
      );
      if (analysis.conflicts.length > 0) {
        throw this.conflict(
          "Run cannot be reverted without conflicts",
          analysis.conflicts,
          { runId, currentVersion },
        );
      }
      if (analysis.inverses.length === 0) {
        throw this.conflict("Run has no revertable commands", [], {
          runId,
          currentVersion,
        });
      }
    } catch (error) {
      if (this.isRunConflict(error)) {
        const winner = await this.matchingRevert(boardId, runId, commandId);
        if (winner !== null) {
          return this.get(boardId, winner.id, role, principal);
        }
      }
      throw error;
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
      const guardedVersion = await this.commands.latestSeq(boardId, tx);
      const current = await tx.agentRun.findFirst({
        where: { id: runId, boardId },
        select: { status: true },
      });
      if (current === null) {
        throw this.conflict("Run no longer exists", [], {
          runId,
          currentVersion: guardedVersion,
        });
      }
      if (current.status !== "applied") {
        throw this.conflict(`Run is already ${current.status}`, [], {
          runId,
          currentVersion: guardedVersion,
        });
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
          { runId, currentVersion: guardedVersion },
        );
      }
      if (
        guarded.inverses.length !== analysis.inverses.length ||
        currentCommands.length !== commands.length
      ) {
        throw this.conflict(
          "Run changed while the revert was being prepared",
          [],
          { runId, currentVersion: guardedVersion },
        );
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
          // M13: internal only. A restore command issued by this run revert
          // may put back rows past the board's current WIP/collection caps.
          exemptRestoreLimits: true,
          // M7: the run may have held the claim through its PAT/session, or
          // claimed over a lapsed lease; the human ADMIN reverting it must be
          // able to restore the pre-run holder/lease either way.
          exemptClaimGuard: true,
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
              throw this.conflict("Run was reverted by another request", [], {
                runId,
                currentVersion: await this.commands.latestSeq(boardId, tx),
              });
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
      // The winner may have committed before this request reached its
      // revalidation (a 409 "already reverted") or during run creation
      // (P2002). Either way, the same key on the same original run is a
      // successful replay, not an error next to a reverted banner.
      const existing = await this.matchingRevert(boardId, runId, commandId);
      if (existing !== null) {
        return this.get(boardId, existing.id, role, principal);
      }
      if (
        typeof error === "object" &&
        error !== null &&
        (error as { code?: unknown }).code === "P2002"
      ) {
        // The key belongs to some other run: never return that run's detail.
        throw this.conflict("clientRunId already used by another run", [], {
          runId,
          currentVersion: await this.commands.latestSeq(boardId),
        });
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

  /** The committed revert run for this exact key and original run, if any. */
  private async matchingRevert(
    boardId: string,
    runId: string,
    commandId: string,
  ): Promise<AgentRun | null> {
    const row = await this.prisma.agentRun.findUnique({
      where: { boardId_clientRunId: { boardId, clientRunId: commandId } },
    });
    return row !== null && row.kind === "revert" && row.revertsRunId === runId
      ? row
      : null;
  }

  private isRunConflict(error: unknown): boolean {
    if (!(error instanceof ConflictException)) return false;
    const response = error.getResponse();
    return (
      typeof response === "object" &&
      response !== null &&
      (response as { code?: unknown }).code === "run_conflict"
    );
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
    // H6: `commandCount` is the run's own record of how many commands it
    // applied. Fewer retained rows (or pre-images) mean retention/cleanup
    // removed part of the run; inverting the rest would silently leave it
    // half-applied and still mark it reverted.
    if (commands.length !== run.commandCount) {
      throw await this.expired(run.id);
    }
    for (const command of commands) {
      if (!preimages.has(command.commandId ?? "")) {
        throw await this.expired(run.id);
      }
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
      if (data === undefined) throw await this.expired(run.id);
      for (const entity of data.entities) {
        if (!boardChanged && entity.touch === boardTouch) continue;
        lastByTouch.set(entity.touch, entity);
      }
    }

    for (const command of [...commands].reverse()) {
      const data = preimages.get(command.commandId ?? "");
      if (data === undefined) throw await this.expired(run.id);
      const hasEntity = data.entities.some(
        (entity) => entity.touch !== boardTouch || boardChanged,
      );
      // C1: a command that wrote no entity is a no-op. Legacy pre-images
      // (stored before the writer stopped recording a no-op inverse) may
      // still carry `DELETE_COLUMN`/`DELETE_CARD`; never replay it.
      if (!hasEntity) continue;
      if (data.inverse === undefined || data.inverse === null) {
        conflicts.push({
          touch: `command:${command.commandId ?? ""}`,
          expectedVersion: 0,
          currentVersion: 0,
          reason: "not_revertable",
        });
        continue;
      }
      inverses.push(data.inverse);
    }

    // M22: a green preview must run the same preconditions apply will.
    const preconditionFailures =
      await this.commands.inspectInversePreconditions(
        boardId,
        inverses,
        client,
        // The revert path restores rows the run itself removed; that is the
        // only caller allowed past the current restore limits (M13). Non-
        // restore inverses (MOVE/UNARCHIVE) are still checked, so the M22
        // WIP preview keeps refusing them.
        { exemptRestoreLimits: true },
      );
    for (const failure of preconditionFailures) {
      conflicts.push({
        touch: failure.touch,
        expectedVersion: 0,
        currentVersion: failure.currentVersion,
        reason: failure.reason,
      });
    }

    // H5: archive/delete inverses can only land in their recorded source
    // column. Walk the inverse sequence, not just the final DB state, so a
    // column deleted *by this same run* is restored by its own
    // `RESTORE_COLUMN` before the card inverse needs it. A column a human
    // deleted after the run has no restore step and still blocks.
    const inverseColumns = new Set<string>();
    for (const action of inverses) {
      if (action.type === "RESTORE_COLUMN") {
        inverseColumns.add(action.column.id);
      } else if (action.type === "DELETE_COLUMN") {
        inverseColumns.add(action.columnId);
      } else if (
        (action.type === "UNARCHIVE_CARD" || action.type === "RESTORE_CARD") &&
        action.columnId !== undefined
      ) {
        inverseColumns.add(action.columnId);
      }
    }
    if (inverseColumns.size > 0) {
      const columnStates = await this.currentStates(
        boardId,
        [...inverseColumns].map((id) => `column:${id}`),
        client,
      );
      const availableColumns = new Set<string>();
      for (const columnId of inverseColumns) {
        const current = columnStates.get(`column:${columnId}`) ?? null;
        if (current !== null && current.deletedAt === null) {
          availableColumns.add(columnId);
        }
      }
      for (const action of inverses) {
        if (action.type === "RESTORE_COLUMN") {
          availableColumns.add(action.column.id);
          continue;
        }
        if (action.type === "DELETE_COLUMN") {
          availableColumns.delete(action.columnId);
          continue;
        }
        const columnId =
          action.type === "UNARCHIVE_CARD" || action.type === "RESTORE_CARD"
            ? action.columnId
            : undefined;
        if (columnId === undefined || availableColumns.has(columnId)) continue;
        const current = columnStates.get(`column:${columnId}`) ?? null;
        conflicts.push({
          touch: `column:${columnId}`,
          expectedVersion: current?.version ?? 0,
          currentVersion: current?.version ?? 0,
          reason: current === null ? "missing" : "deleted",
        });
      }
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
    // One row per `touch`: the UI keys conflicts by `touch`, and H4/H5 can
    // describe the same column from different angles. Keep the first, most
    // specific reason (H5 deletion is added before the version comparison).
    const byTouch = new Map<string, RevertConflictDto>();
    for (const conflict of conflicts) {
      if (!byTouch.has(conflict.touch)) byTouch.set(conflict.touch, conflict);
    }
    const deduped = [...byTouch.values()].sort((a, b) =>
      a.touch.localeCompare(b.touch),
    );

    return { conflicts: deduped, inverses, lastByTouch, currentByTouch };
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
    context: { runId?: string; currentVersion?: number } = {},
  ): ConflictException {
    return new ConflictException({
      message,
      code: "run_conflict",
      retryable: false,
      ...(context.runId !== undefined ? { runId: context.runId } : {}),
      ...(context.currentVersion !== undefined
        ? { currentVersion: context.currentVersion }
        : {}),
      ...(conflicts.length > 0 ? { conflicts, details: { conflicts } } : {}),
    });
  }

  private async expired(runId: string): Promise<ConflictException> {
    const retentionDays =
      (await this.ops.retentionDays()) ?? env.PURGE_AFTER_DAYS;
    return new ConflictException({
      message: "Run or its pre-images were removed by retention",
      code: "run_expired",
      retryable: false,
      runId,
      retentionDays,
    });
  }
}
