import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type {
  Board,
  BoardAction,
  BoardScopedAction,
  CommandDeltaEntry,
  CommandResponse,
  ConflictError,
} from "@janosik/shared";
import {
  atWipLimit,
  boardReducer,
  LIMITS,
  validateBoardAction,
} from "@janosik/shared";
import { loadBoardAggregate } from "@/boards/board-aggregate";
import { PrismaService } from "@/common/prisma/prisma.service";
import { applyCommandWrites, collectVersions } from "./command-writers";
import type { CreateCommandDto } from "./dto/create-command.dto";

/**
 * Command-log transport (§7.4, TASK-26).
 *
 * The server replays the *same* `boardReducer` the client uses, writes the
 * command row and mirrors the resulting board into the normalized tables
 * through per-action writers (§7.4.1 variant В). `commandId` is the primary
 * key, so a retry returns the stored `result` without a second entity or a
 * second `seq`.
 *
 * TASK-27 (labels/checklists) and later tasks are rejected up front: this
 * module implements column and card actions only, on purpose.
 *
 * Commands that reference unknown entities no-op exactly like the reducer
 * and are still recorded (a replay returns the stored no-op result): the
 * API mirrors the reducer instead of second-guessing it (§7.4.1).
 */
const SUPPORTED_ACTIONS = new Set<string>([
  "ADD_COLUMN",
  "RENAME_COLUMN",
  "DELETE_COLUMN",
  "DUPLICATE_COLUMN",
  "MOVE_COLUMN",
  "SORT_COLUMN",
  "SET_COLUMN_WIP_LIMIT",
  "SET_COLUMN_CARD_ORDER",
  "ADD_CARD",
  "UPDATE_CARD",
  "TOUCH_CARD",
  "DELETE_CARD",
  "ARCHIVE_CARD",
  "UNARCHIVE_CARD",
  "ARCHIVE_COLUMN_CARDS",
  "SET_CARD_DUE_DATE",
  "SET_CARD_COVER",
  "MOVE_CARD",
  "DUPLICATE_CARD",
  "RESTORE_CARD",
  "RESTORE_COLUMN",
  "RESTORE_COLUMN_CARDS",
  "RESTORE_CHECKLIST",
  "RESTORE_CHECKLIST_ITEM",
]);

@Injectable()
export class CommandsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Apply one command idempotently, or return its stored result on replay. */
  async apply(
    boardId: string,
    actorId: string,
    dto: CreateCommandDto,
  ): Promise<CommandResponse> {
    const validation = validateBoardAction(dto.action);
    if (!validation.ok) {
      throw new BadRequestException({
        message: `Invalid command (${validation.field}): ${validation.message}`,
        field: validation.field,
      });
    }
    const action = validation.action;
    if (!SUPPORTED_ACTIONS.has(action.type)) {
      throw new BadRequestException({
        message: `Unsupported command type in TASK-26: ${action.type}`,
        field: "action.type",
      });
    }

    return this.prisma.$transaction(async (tx) => {
      // Serialize commands per board on the board row itself: concurrent
      // requests queue here, so the `ifMatch` check below sees every
      // committed predecessor. Without this lock two parallel commands with
      // the same `ifMatch` would both pass under Read Committed (reproduced
      // in review, 2026-09-16). Other boards never block each other.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Board"
        WHERE "id" = ${boardId} AND "deletedAt" IS NULL
        FOR UPDATE
      `;
      if (locked.length === 0) {
        throw new NotFoundException("Board not found");
      }

      const existing = await tx.command.findUnique({
        where: { id: dto.commandId },
      });
      if (existing) {
        if (existing.boardId !== boardId) {
          throw new ConflictException({
            message: "commandId already used on another board",
            field: "commandId",
          });
        }
        return existing.result as unknown as CommandResponse;
      }

      const before = await loadBoardAggregate(tx, boardId);
      if (!before) {
        throw new NotFoundException("Board not found");
      }

      const currentVersion = await this.currentSeq(tx, boardId);
      if (dto.ifMatch !== undefined && dto.ifMatch !== currentVersion) {
        throw new ConflictException({
          conflict: "version",
          currentVersion,
        } satisfies ConflictError);
      }
      this.assertNoWipConflict(before, action, currentVersion);

      const at = (action as BoardScopedAction).at;
      const state = boardReducer(
        [before],
        Object.assign({}, action, { boardId }) as BoardAction,
        { withActivity: false },
      );
      const after = state[0] ?? before;
      const changed = stableStringify(before) !== stableStringify(after);

      const created = await tx.command.create({
        data: {
          id: dto.commandId,
          boardId,
          actorId,
          type: action.type,
          payload: jsonSafe(action),
          result: {},
          touches: [],
        },
      });
      const seq = Number(created.seq);

      let touches: string[] = [];
      if (changed) {
        touches = await applyCommandWrites(tx, {
          boardId,
          action,
          before,
          after,
          at,
        });
      }
      const versions = changed
        ? await collectVersions(tx, boardId, touches)
        : {};
      const response: CommandResponse = { seq, versions };

      await tx.command.update({
        where: { id: created.id },
        data: {
          payload: jsonSafe(action),
          result: jsonSafe(response),
          touches,
        },
      });
      return response;
    });
  }

  /** Commands with `seq > since`, oldest first — the SSE delta catch-up. */
  async listSince(
    boardId: string,
    since: number,
  ): Promise<CommandDeltaEntry[]> {
    const rows = await this.prisma.command.findMany({
      where: {
        boardId,
        ...(since > 0 ? { seq: { gt: BigInt(since) } } : {}),
      },
      orderBy: { seq: "asc" },
      select: { seq: true, actorId: true, payload: true },
    });
    return rows.map((row) => ({
      seq: Number(row.seq),
      action: row.payload as unknown as BoardAction,
      actorId: row.actorId,
    }));
  }

  /** Highest committed `seq` for the board, or 0 when it has no commands. */
  private async currentSeq(
    tx: Prisma.TransactionClient,
    boardId: string,
  ): Promise<number> {
    const aggregate = await tx.command.aggregate({
      where: { boardId },
      _max: { seq: true },
    });
    return aggregate._max.seq === null ? 0 : Number(aggregate._max.seq);
  }

  /**
   * Mirror the reducer's collection guards. A command that would grow a
   * collection past a `LIMITS` bound or a column past its WIP limit is
   * refused with `409 { conflict: "wip" }` — the same `atWipLimit` predicate
   * the client uses. Inverse commands add nothing new and are never refused
   * (AGENT.md undo rule).
   */
  private assertNoWipConflict(
    board: Board,
    action: BoardAction,
    currentVersion: number,
  ): void {
    if ("inverse" in action && action.inverse === true) return;
    const reject = (): never => {
      throw new ConflictException({
        conflict: "wip",
        currentVersion,
      } satisfies ConflictError);
    };
    const columnBlocked = (column: Board["columns"][number] | undefined) =>
      column !== undefined &&
      (column.cardIds.length >= LIMITS.cardsPerColumn ||
        atWipLimit(column, true));

    switch (action.type) {
      case "ADD_CARD": {
        if (
          columnBlocked(board.columns.find((c) => c.id === action.columnId))
        ) {
          reject();
        }
        return;
      }
      case "DUPLICATE_CARD": {
        const source = board.cards[action.cardId];
        if (!source) return;
        const column = board.columns.find((c) => c.cardIds.includes(source.id));
        if (columnBlocked(column)) reject();
        return;
      }
      case "MOVE_CARD": {
        if (action.fromColumnId === action.toColumnId) return;
        if (
          columnBlocked(board.columns.find((c) => c.id === action.toColumnId))
        ) {
          reject();
        }
        return;
      }
      case "UNARCHIVE_CARD": {
        const column =
          board.columns.find((c) => c.id === action.columnId) ??
          board.columns[0];
        if (columnBlocked(column)) reject();
        return;
      }
      case "RESTORE_CARD": {
        if (action.columnId === undefined) return;
        if (
          columnBlocked(board.columns.find((c) => c.id === action.columnId))
        ) {
          reject();
        }
        return;
      }
      case "ADD_COLUMN":
      case "DUPLICATE_COLUMN":
      case "RESTORE_COLUMN": {
        if (board.columns.length >= LIMITS.columnsPerBoard) reject();
        return;
      }
      default:
        return;
    }
  }
}

/** JSON round-trip so no `undefined` reaches a Prisma `Json` column. */
function jsonSafe(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

/** Deterministic serialization for the before/after "did it change?" check. */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(entry).sort()) {
        sorted[key] = (entry as Record<string, unknown>)[key];
      }
      return sorted;
    }
    return entry;
  });
}
