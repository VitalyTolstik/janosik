import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from "@nestjs/common";
import { Role } from "@prisma/client";
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
  MAX_COMMAND_BYTES,
  validateBoardAction,
} from "@janosik/shared";
import { loadBoardAggregate } from "@/boards/board-aggregate";
import { PrismaService } from "@/common/prisma/prisma.service";
import { RealtimeService } from "@/realtime/realtime.service";
import { applyCommandWrites, collectVersions } from "./command-writers";
import { commandDetails } from "./command-details";
import { referencedEntityIds } from "./referenced-entity-ids";
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
 * `SUPPORTED_ACTIONS` is the command surface the reducer and the writers
 * understand: board-scoped columns, cards, labels, checklists (TASK-26/27)
 * plus the board-level `RENAME_BOARD`/`ARCHIVE_BOARD`/`UNARCHIVE_BOARD`
 * commands (TASK-29). Only array-level/aggregate REST operations (board
 * create/import/delete) are rejected here instead of being half-applied.
 *
 * Commands that reference unknown entities no-op exactly like the reducer
 * and are still recorded (a replay returns the stored no-op result): the
 * API mirrors the reducer instead of second-guessing it (§7.4.1).
 */
const SUPPORTED_ACTIONS = new Set<string>([
  "RENAME_BOARD",
  "ARCHIVE_BOARD",
  "UNARCHIVE_BOARD",
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
  "SET_CARD_LABEL",
  "ADD_LABEL",
  "RENAME_LABEL",
  "SET_LABEL_COLOR",
  "DELETE_LABEL",
  "ADD_CHECKLIST",
  "RENAME_CHECKLIST",
  "DELETE_CHECKLIST",
  "ADD_CHECKLIST_ITEM",
  "SET_CHECKLIST_ITEM_DONE",
  "RENAME_CHECKLIST_ITEM",
  "DELETE_CHECKLIST_ITEM",
  "RESTORE_CARD",
  "RESTORE_COLUMN",
  "RESTORE_COLUMN_CARDS",
  "RESTORE_LABEL",
  "RESTORE_CHECKLIST",
  "RESTORE_CHECKLIST_ITEM",
]);

@Injectable()
export class CommandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Apply one command idempotently, or return its stored result on replay. */
  async apply(
    boardId: string,
    actorId: string,
    dto: CreateCommandDto,
  ): Promise<CommandResponse> {
    // An oversized action is refused before anything else runs (TASK-30.2):
    // the writers would happily persist megabytes of snapshot/activity ids.
    const bytes = Buffer.byteLength(JSON.stringify(dto.action), "utf8");
    if (bytes > MAX_COMMAND_BYTES) {
      throw new PayloadTooLargeException({
        message: `Command is too large (${bytes} bytes, max ${MAX_COMMAND_BYTES})`,
        field: "action",
      });
    }
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
        message: `Unsupported command type: ${action.type}`,
        field: "action.type",
      });
    }

    const applied = await this.prisma.$transaction(
      async (
        tx,
      ): Promise<{
        response: CommandResponse;
        fresh: boolean;
        touches: string[];
      }> => {
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
          return {
            response: existing.result as unknown as CommandResponse,
            fresh: false,
            touches: [],
          };
        }

        // Entity ids are global primary keys while commands are board-scoped:
        // an id that already lives on another board would be silently
        // rewritten by the upserts below (TASK-30.2). Replays skip this
        // check — their stored result must stay reproducible.
        await this.assertIdsBelongToBoard(
          tx,
          boardId,
          referencedEntityIds(action),
        );

        const before = await loadBoardAggregate(tx, boardId);
        if (!before) {
          throw new NotFoundException("Board not found");
        }

        await this.assertBoardManagement(tx, boardId, actorId, action.type);

        const currentVersion = await this.currentSeq(tx, boardId);
        await this.assertVersionPreconditions(
          tx,
          boardId,
          dto.ifMatchVersions,
          currentVersion,
        );
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
        // Freeze the display diff while both aggregates are in hand (TASK-37)
        // — the history feed reads it back; the payload stays a pure action.
        const details = changed ? commandDetails(action, before, after) : null;

        const created = await tx.command.create({
          data: {
            id: dto.commandId,
            boardId,
            actorId,
            type: action.type,
            payload: jsonSafe(action),
            result: {},
            ...(details !== null
              ? { details: jsonSafe(details) as Prisma.InputJsonValue }
              : {}),
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
            actorId,
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
        return { response, fresh: true, touches };
      },
    );

    // Publish only after the transaction committed: a subscriber must never
    // replay a command the database could still roll back. A replay of an
    // existing `commandId` publishes nothing — that `seq` already went out.
    // `touches` rides along (TASK-30.1): it is what the command actually
    // wrote, so subscribers mark their undo history foreign without diffing
    // the whole board.
    if (applied.fresh) {
      this.realtime.publish(boardId, {
        type: "command",
        seq: applied.response.seq,
        action,
        actorId,
        touches: applied.touches,
      });
    }
    return applied.response;
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
      select: { seq: true, actorId: true, payload: true, touches: true },
    });
    return rows.map((row) => ({
      seq: Number(row.seq),
      action: row.payload as unknown as BoardAction,
      actorId: row.actorId,
      touches: row.touches,
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
   * Every client-supplied entity id must either be free or belong to this
   * board (TASK-30.2). The writers upsert by global id, so a colliding id
   * from another board would rewrite that board's row — rename a foreign
   * column, steal a card into this board's column, re-parent a checklist.
   * Soft-deleted rows keep their board and pass (that is exactly the redo
   * path); ids that exist nowhere are creates and pass too.
   */
  private async assertIdsBelongToBoard(
    tx: Prisma.TransactionClient,
    boardId: string,
    ids: string[],
  ): Promise<void> {
    if (ids.length === 0) return;
    const foreignFilter = { id: { in: ids }, boardId: { not: boardId } };
    const cardFilter = {
      id: { in: ids },
      column: { boardId: { not: boardId } },
    };

    const offenders = [
      {
        table: "column",
        row: await tx.column.findFirst({
          where: foreignFilter,
          select: { id: true },
        }),
      },
      {
        table: "card",
        row: await tx.card.findFirst({
          where: cardFilter,
          select: { id: true },
        }),
      },
      {
        table: "label",
        row: await tx.label.findFirst({
          where: foreignFilter,
          select: { id: true },
        }),
      },
      {
        table: "checklist",
        row: await tx.checklist.findFirst({
          where: {
            id: { in: ids },
            card: { column: { boardId: { not: boardId } } },
          },
          select: { id: true },
        }),
      },
      {
        table: "checklistItem",
        row: await tx.checklistItem.findFirst({
          where: {
            id: { in: ids },
            checklist: { card: { column: { boardId: { not: boardId } } } },
          },
          select: { id: true },
        }),
      },
      {
        table: "activity",
        row: await tx.activity.findFirst({
          where: foreignFilter,
          select: { id: true },
        }),
      },
    ];
    const offender = offenders.find((entry) => entry.row !== null);
    if (offender?.row) {
      throw new ConflictException({
        message: `Entity id already used on another board: ${offender.table}:${offender.row.id}`,
        field: "action",
      });
    }
  }

  /**
   * Board management is ADMIN-only in the service, not in the route guard:
   * the command endpoint allows ADMIN/MEMBER for every action (§7.0), while
   * `@BoardRoles` metadata cannot vary by action type. Renaming stays
   * collaborative; archiving/unarchiving is board administration (TASK-29).
   */
  private async assertBoardManagement(
    tx: Prisma.TransactionClient,
    boardId: string,
    actorId: string,
    actionType: string,
  ): Promise<void> {
    if (actionType !== "ARCHIVE_BOARD" && actionType !== "UNARCHIVE_BOARD") {
      return;
    }
    const membership = await tx.boardMember.findUnique({
      where: { boardId_userId: { boardId, userId: actorId } },
      select: { role: true },
    });
    if (membership?.role !== Role.ADMIN) {
      throw new ForbiddenException(
        "Only an ADMIN can archive or unarchive the board",
      );
    }
  }

  /**
   * Enforce the per-entity preconditions from `CommandRequest.ifMatchVersions`
   * (TASK-29 §7.0): undo of a text edit must not clobber a foreign edit, so
   * every `touch` key the client sends must still hold the version it last
   * saw. Positional changes stay last-write-wins and simply omit the map.
   * A stale or missing entity is `409 { conflict: "version" }` carrying the
   * board's `currentVersion`; an unknown key or a non-integer value is a
   * client bug answered with `400 { field: "ifMatchVersions" }`.
   */
  private async assertVersionPreconditions(
    tx: Prisma.TransactionClient,
    boardId: string,
    preconditions: Record<string, number> | undefined,
    currentVersion: number,
  ): Promise<void> {
    if (!preconditions) return;
    for (const [key, expected] of Object.entries(preconditions)) {
      if (!Number.isInteger(expected) || expected < 0) {
        throw new BadRequestException({
          message: `Invalid ifMatchVersions value for ${key}: must be an integer >= 0`,
          field: "ifMatchVersions",
        });
      }
      const match =
        /^(board|column|card|label|checklist|checklistItem):(.+)$/.exec(key);
      // A `board:` key is only meaningful for the board the command targets;
      // any other board id is a client bug, not a precondition to check.
      if (!match || (match[1] === "board" && match[2] !== boardId)) {
        throw new BadRequestException({
          message: `Unknown ifMatchVersions key: ${key}`,
          field: "ifMatchVersions",
        });
      }
      const actual = await entityVersion(tx, match[1], match[2]);
      if (actual === null || actual !== expected) {
        throw new ConflictException({
          conflict: "version",
          currentVersion,
        } satisfies ConflictError);
      }
    }
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
      case "ADD_LABEL":
      case "RESTORE_LABEL": {
        // A duplicate id is a reducer no-op, not a limit violation.
        if (board.labels.some((label) => label.id === action.label.id)) return;
        if (board.labels.length >= LIMITS.labelsPerBoard) reject();
        return;
      }
      case "SET_CARD_LABEL": {
        if (!action.on) return;
        const card = board.cards[action.cardId];
        if (!card || card.labelIds.includes(action.labelId)) return;
        // An unknown label never attaches (the reducer ignores it).
        if (!board.labels.some((label) => label.id === action.labelId)) return;
        if (card.labelIds.length >= LIMITS.labelsPerCard) reject();
        return;
      }
      case "ADD_CHECKLIST":
      case "RESTORE_CHECKLIST": {
        const card = board.cards[action.cardId];
        if (!card) return;
        const checklists = card.checklists ?? [];
        const id =
          action.type === "ADD_CHECKLIST"
            ? action.newChecklistId
            : action.checklist.id;
        if (checklists.some((checklist) => checklist.id === id)) return;
        if (checklists.length >= LIMITS.checklistsPerCard) reject();
        return;
      }
      case "ADD_CHECKLIST_ITEM":
      case "RESTORE_CHECKLIST_ITEM": {
        const card = board.cards[action.cardId];
        if (!card) return;
        const items =
          card.checklists?.find((c) => c.id === action.checklistId)?.items ??
          [];
        const id =
          action.type === "ADD_CHECKLIST_ITEM"
            ? action.newItemId
            : action.item.id;
        if (items.some((item) => item.id === id)) return;
        if (items.length >= LIMITS.itemsPerChecklist) reject();
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

/**
 * Current `version` of one `touch` target (`board:<id>`, `card:<id>`, …), or
 * `null` when no such row exists (soft-deleted rows keep theirs, exactly like
 * `collectVersions` reports them).
 */
async function entityVersion(
  tx: Prisma.TransactionClient,
  entity: string,
  id: string,
): Promise<number | null> {
  switch (entity) {
    case "board": {
      const row = await tx.board.findUnique({
        where: { id },
        select: { version: true },
      });
      return row?.version ?? null;
    }
    case "column": {
      const row = await tx.column.findUnique({
        where: { id },
        select: { version: true },
      });
      return row?.version ?? null;
    }
    case "card": {
      const row = await tx.card.findUnique({
        where: { id },
        select: { version: true },
      });
      return row?.version ?? null;
    }
    case "label": {
      const row = await tx.label.findUnique({
        where: { id },
        select: { version: true },
      });
      return row?.version ?? null;
    }
    case "checklist": {
      const row = await tx.checklist.findUnique({
        where: { id },
        select: { version: true },
      });
      return row?.version ?? null;
    }
    case "checklistItem": {
      const row = await tx.checklistItem.findUnique({
        where: { id },
        select: { version: true },
      });
      return row?.version ?? null;
    }
    default:
      return null;
  }
}
