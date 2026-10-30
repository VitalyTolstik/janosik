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
  cardOf,
  hasLinkedPair,
  LIMITS,
  MAX_COMMAND_BYTES,
  validateBoardAction,
  wouldCloseBlocksCycle,
} from "@janosik/shared";
import { loadBoardAggregate } from "@/boards/board-aggregate";
import { PrismaService } from "@/common/prisma/prisma.service";
import { BoardWriteService } from "@/common/board-write.service";
import { activeMembershipWhere } from "@/common/membership";
import {
  type InternalCommandEvent,
  RealtimeService,
} from "@/realtime/realtime.service";
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
/**
 * Every action type the command endpoint understands: the reducer's
 * board-scoped surface plus the two board-management commands. The four
 * aggregate-level actions (`RESTORE_BOARD`, `IMPORT_BOARDS`, `ADD_BOARD`,
 * `REMOVE_BOARD`) are board create/import/delete and are rejected here.
 */
type CommandActionType = Exclude<
  BoardAction["type"],
  "RESTORE_BOARD" | "IMPORT_BOARDS" | "ADD_BOARD" | "REMOVE_BOARD"
>;

/**
 * TASK-96: the registry is a `Record` keyed by every command type, so a new
 * `BoardAction` is a *compile* error here until it is classified — the
 * endpoint can no longer silently reject it. The `Set` is derived from the
 * registry so the two can never drift.
 */
const SUPPORTED_ACTION_REGISTRY: Record<CommandActionType, true> = {
  RENAME_BOARD: true,
  ARCHIVE_BOARD: true,
  UNARCHIVE_BOARD: true,
  ADD_COLUMN: true,
  RENAME_COLUMN: true,
  DELETE_COLUMN: true,
  DUPLICATE_COLUMN: true,
  MOVE_COLUMN: true,
  SORT_COLUMN: true,
  SET_COLUMN_WIP_LIMIT: true,
  SET_COLUMN_CARD_ORDER: true,
  ADD_CARD: true,
  UPDATE_CARD: true,
  TOUCH_CARD: true,
  DELETE_CARD: true,
  ARCHIVE_CARD: true,
  UNARCHIVE_CARD: true,
  ARCHIVE_COLUMN_CARDS: true,
  SET_CARD_DUE_DATE: true,
  SET_CARD_PRIORITY: true,
  SET_CARD_ASSIGN: true,
  CLAIM_CARD: true,
  ADD_CARD_LINK: true,
  REMOVE_CARD_LINK: true,
  SET_CARD_COVER: true,
  MOVE_CARD: true,
  DUPLICATE_CARD: true,
  SET_CARD_LABEL: true,
  ADD_LABEL: true,
  RENAME_LABEL: true,
  SET_LABEL_COLOR: true,
  DELETE_LABEL: true,
  ADD_CHECKLIST: true,
  RENAME_CHECKLIST: true,
  DELETE_CHECKLIST: true,
  ADD_CHECKLIST_ITEM: true,
  SET_CHECKLIST_ITEM_DONE: true,
  RENAME_CHECKLIST_ITEM: true,
  DELETE_CHECKLIST_ITEM: true,
  RESTORE_CARD: true,
  RESTORE_COLUMN: true,
  RESTORE_COLUMN_CARDS: true,
  RESTORE_LABEL: true,
  RESTORE_CHECKLIST: true,
  RESTORE_CHECKLIST_ITEM: true,
};

const SUPPORTED_ACTIONS = new Set<string>(
  Object.keys(SUPPORTED_ACTION_REGISTRY),
);

/**
 * TASK-80: the only actions allowed to skip the collection/WIP guards. They
 * re-add data that already existed (undo of a delete), so refusing them would
 * make undo impossible. The client-supplied `inverse` flag is *not* trusted:
 * any other action — including a forged `inverse: true` on `ADD_CARD` or
 * `SET_CARD_ASSIGN` — is checked exactly like a fresh one.
 */
const RESTORE_ACTIONS = new Set<string>([
  "RESTORE_CARD",
  "RESTORE_COLUMN",
  "RESTORE_COLUMN_CARDS",
  "RESTORE_LABEL",
  "RESTORE_CHECKLIST",
  "RESTORE_CHECKLIST_ITEM",
]);

/**
 * Upper bound on a single delta catch-up (TASK-84). The retention sweep keeps
 * the log bounded anyway; this is the belt-and-braces cap so a `?since=0`
 * request can never materialize an unbounded history.
 */
export const COMMAND_DELTA_MAX = 5_000;

/**
 * TASK-156 (item 17): the ceiling the internal `allowOversize` bypass may
 * reach — the companion of the shared `MAX_COMMAND_BYTES` (2 MiB) client cap.
 * Internal admin restores pack a whole column's snapshot into one
 * `RESTORE_COLUMN` (~6 MB for a full column of large cards), which must not
 * 413 — but the bypass still may not be unlimited: everything above this
 * lands in `Command.action` JSONB and in one SSE frame per subscriber, so it
 * stays finite (8 MiB, 4× the client cap) and everything larger is a 413.
 */
export const MAX_COMMAND_BYTES_INTERNAL = 8 * 1024 * 1024;

/**
 * B-5: how far a client's `action.at` may drift from the server clock and
 * still be trusted. The reducer turns `at` into `createdAt`/`updatedAt`/
 * `deletedAt`/`archivedAt`; an unbounded value let a client backdate a
 * delete to 1970 (→ the next purge erased it past the restore window) or
 * send `1e300` (→ Invalid Date → 500). Anything outside the window is
 * replaced by the server's own clock before the reducer runs.
 */
export const COMMAND_AT_MAX_SKEW_MS = 5 * 60 * 1000;

/** ECMAScript's Date range: ±8.64e15 ms around the epoch. */
const MAX_DATE_MS = 8.64e15;

/**
 * One page of the command delta (B-3). `resync` means the gap since the
 * caller's baseline can *not* be replayed faithfully — the delta hit its cap,
 * or the baseline command was trimmed from the log — so the caller must
 * re-read the board snapshot instead of trusting `entries`.
 */
export interface CommandDelta {
  entries: CommandDeltaEntry[];
  resync: boolean;
}

@Injectable()
export class CommandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly boardWrite: BoardWriteService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Apply one command idempotently, or return its stored result on replay. */
  async apply(
    boardId: string,
    actorId: string,
    dto: CreateCommandDto,
    options: { allowOversize?: boolean } = {},
  ): Promise<CommandResponse> {
    // An oversized action is refused before anything else runs (TASK-30.2):
    // the writers would happily persist megabytes of snapshot/activity ids.
    // Internal admin restores may exceed the client cap (RESTORE_COLUMN
    // carries a whole column's snapshot, TASK-156) but not the internal one
    // — the caller is trusted, the JSONB row and the SSE frame are not.
    const bytes = Buffer.byteLength(JSON.stringify(dto.action), "utf8");
    const cap =
      options.allowOversize === true
        ? MAX_COMMAND_BYTES_INTERNAL
        : MAX_COMMAND_BYTES;
    if (bytes > cap) {
      throw new PayloadTooLargeException({
        message: `Command is too large (${bytes} bytes, max ${cap})`,
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
    if (!SUPPORTED_ACTIONS.has(validation.action.type)) {
      throw new BadRequestException({
        message: `Unsupported command type: ${validation.action.type}`,
        field: "action.type",
      });
    }
    assertDatesInRange(validation.action);
    // TASK-147 follow-up: the `ifMatchVersions` cap is enforced HERE, before
    // `boardWrite.run` takes the per-board queue and the advisory lock — an
    // oversized map must be a cheap 400, not 5 MB serialized through the
    // board writer (the in-transaction check stays as defence in depth).
    this.assertIfMatchVersionsSize(dto.ifMatchVersions);
    // Identity of the request for the idempotency check below — taken before
    // the clamp, so an honest retry (same body, later wall clock) still
    // matches the stored command.
    const requestFingerprint = actionFingerprint(validation.action);
    const action = clampActionAt(validation.action, Date.now());

    const applied = await this.boardWrite.run(
      boardId,
      async (
        tx,
      ): Promise<{
        response: CommandResponse;
        fresh: boolean;
        touches: string[];
        prevSeq: number;
      }> => {
        // The board write lock (BoardWriteService) already serializes every
        // command on this board — the `ifMatch` check below sees each
        // committed predecessor. We only need the board to exist.
        const board = await tx.board.findFirst({
          where: { id: boardId, deletedAt: null },
          select: { id: true },
        });
        if (!board) {
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
          // A reused key with a different body is a client bug (or a key
          // collision), not a retry: answering with the first command's
          // result would tell the caller its *new* action was applied.
          if (actionFingerprint(existing.payload) !== requestFingerprint) {
            throw new ConflictException({
              message: "commandId already used with a different payload",
              field: "commandId",
            });
          }
          return {
            response: existing.result as unknown as CommandResponse,
            fresh: false,
            touches: [],
            prevSeq: 0,
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
        await this.assertAssigneeIsBoardMember(tx, boardId, action);
        await this.assertClaimIsFree(tx, boardId, action);

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
        return { response, fresh: true, touches, prevSeq: currentVersion };
      },
    );

    // Publish only after the transaction committed: a subscriber must never
    // replay a command the database could still roll back. A replay of an
    // existing `commandId` publishes nothing — that `seq` already went out.
    // `touches` rides along (TASK-30.1): it is what the command actually
    // wrote, so subscribers mark their undo history foreign without diffing
    // the whole board.
    //
    // `commandId` lets a client recognise its own echo by key (one account
    // may run several writers). `prevSeq` — the board's seq right before
    // this command, known because the board lock serialized it — is an
    // internal hint for the stream (B-4): a subscriber whose last delivered
    // seq differs knows it missed something and re-reads the log. It is
    // stripped before the frame goes out on the wire.
    if (applied.fresh) {
      const event: InternalCommandEvent = {
        type: "command",
        seq: applied.response.seq,
        action,
        actorId,
        commandId: dto.commandId,
        touches: applied.touches,
        prevSeq: applied.prevSeq,
      };
      this.realtime.publish(boardId, event);
    }
    return applied.response;
  }

  /**
   * Commands with `seq > since`, oldest first — the SSE delta catch-up.
   *
   * Capped (TASK-84): a `since=0` catch-up must never pull a board's whole
   * history into memory / a single SSE frame. Combined with the `Command`
   * retention sweep the window is bounded; a client whose baseline is older
   * than what remains re-reads the board envelope anyway (its seq drives the
   * next connection).
   */
  async listSince(
    boardId: string,
    since: number,
  ): Promise<CommandDeltaEntry[]> {
    return (await this.deltaSince(boardId, since)).entries;
  }

  /**
   * The delta plus whether it is complete (B-3). `seq` is global, so a gap
   * in the numbers is normal and proves nothing; what *does* prove a lost
   * gap is:
   * - the page hit `COMMAND_DELTA_MAX` (more commands remain), or
   * - the caller's baseline `since` (always a seq of this board's own log —
   *   it comes from `X-Board-Seq`, a command response or a stream frame) is
   *   no longer in the log: the retention sweep trimmed it, and possibly
   *   commands after it.
   * Either way `resync: true` — the caller must re-read the board snapshot.
   */
  async deltaSince(
    boardId: string,
    since: number,
    max: number = COMMAND_DELTA_MAX,
  ): Promise<CommandDelta> {
    if (since > 0) {
      const baseline = await this.prisma.command.findFirst({
        where: { boardId, seq: BigInt(since) },
        select: { seq: true },
      });
      if (baseline === null) {
        return { entries: [], resync: true };
      }
    }
    const rows = await this.prisma.command.findMany({
      where: {
        boardId,
        ...(since > 0 ? { seq: { gt: BigInt(since) } } : {}),
      },
      orderBy: { seq: "asc" },
      // One extra row tells "exactly max" apart from "more than max".
      take: max + 1,
      select: {
        id: true,
        seq: true,
        actorId: true,
        payload: true,
        touches: true,
      },
    });
    const truncated = rows.length > max;
    return {
      entries: (truncated ? rows.slice(0, max) : rows).map((row) => ({
        seq: Number(row.seq),
        action: row.payload as unknown as BoardAction,
        actorId: row.actorId,
        commandId: row.id,
        touches: row.touches,
      })),
      resync: truncated,
    };
  }

  /** Highest committed `seq` of the board (0 without commands). */
  async latestSeq(boardId: string): Promise<number> {
    const aggregate = await this.prisma.command.aggregate({
      where: { boardId },
      _max: { seq: true },
    });
    return aggregate._max.seq === null ? 0 : Number(aggregate._max.seq);
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
        table: "cardLink",
        row: await tx.cardLink.findFirst({
          where: foreignFilter,
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
      // TASK-112: answer with the `ConflictError` shape the client knows
      // (`conflict` + `currentVersion`), while keeping the `field`/`message`
      // envelope the command endpoint uses for its other 4xx bodies.
      throw new ConflictException({
        conflict: "id",
        currentVersion: await this.currentSeq(tx, boardId),
        message: `Entity id already used on another board: ${offender.table}:${offender.row.id}`,
        field: "action",
      } satisfies ConflictError & { message: string; field: string });
    }
  }

  /**
   * Jira-style assignee (TASK-49): the assignee must be an active board
   * member — a row that has accepted its invitation (TASK-35 addendum)
   * and is not an expired VIEWER. TASK-80: the check is unconditional — a
   * forged `inverse: true` must not let a client assign a non-member.
   *
   * TASK-147 (B5): a restored card carries its old snapshot, assignee
   * included, so `RESTORE_CARD` gets the same rule — a member who was removed
   * or whose VIEWER budget lapsed while the card was deleted is dropped
   * instead of silently re-attached.
   */
  private async assertAssigneeIsBoardMember(
    tx: Prisma.TransactionClient,
    boardId: string,
    action: BoardAction,
  ): Promise<void> {
    if (action.type === "RESTORE_CARD") {
      const assigneeId = action.card.assigneeId ?? null;
      if (assigneeId !== null) {
        const member = await tx.boardMember.findFirst({
          where: {
            boardId,
            userId: assigneeId,
            ...activeMembershipWhere(),
          },
          select: { id: true },
        });
        if (!member) {
          const withoutAssignee = { ...action.card };
          delete withoutAssignee.assigneeId;
          action.card = withoutAssignee;
        }
      }
      return;
    }
    if (action.type !== "SET_CARD_ASSIGN") return;
    if (action.assigneeId === null) return;
    const member = await tx.boardMember.findFirst({
      where: {
        boardId,
        userId: action.assigneeId,
        ...activeMembershipWhere(),
      },
      select: { id: true },
    });
    if (!member) {
      throw new BadRequestException({
        message: "Assignee must be an active board member",
        field: "action.assigneeId",
      });
    }
  }

  /**
   * Atomic claim guard (TASK-157): a `CLAIM_CARD` may not take a lease that
   * another member still holds. A lapsed lease (`leaseUntil` in the past) is
   * free — that self-healing is the point of a lease. The read and the reject
   * run inside the same board-write transaction, so two agents racing for one
   * card cannot both win; the loser gets a `400` naming the current holder.
   */
  private async assertClaimIsFree(
    tx: Prisma.TransactionClient,
    boardId: string,
    action: BoardAction,
  ): Promise<void> {
    if (action.type !== "CLAIM_CARD") return;
    if (action.claimedBy === null || action.leaseUntil === null) return;
    const card = await tx.card.findFirst({
      where: { id: action.cardId, column: { boardId } },
      select: { claimedBy: true, leaseUntil: true },
    });
    if (
      card &&
      card.claimedBy !== null &&
      card.claimedBy !== action.claimedBy &&
      card.leaseUntil !== null &&
      card.leaseUntil.getTime() > Date.now()
    ) {
      throw new BadRequestException({
        message: `Card is claimed by another member until ${card.leaseUntil.toISOString()}`,
        field: "action.claimedBy",
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
   * The precondition map's size ceiling, checked *before* the board lock
   * (TASK-147 follow-up). Kept separate so the boundary is testable without a
   * transaction: an oversized `ifMatchVersions` is a cheap `400`, never a
   * multi-megabyte request that reaches the board writer.
   */
  private assertIfMatchVersionsSize(
    preconditions: Record<string, number> | undefined,
  ): void {
    if (
      preconditions !== undefined &&
      Object.keys(preconditions).length > MAX_IF_MATCH_VERSIONS
    ) {
      throw new BadRequestException({
        message: `Too many ifMatchVersions keys (max ${MAX_IF_MATCH_VERSIONS})`,
        field: "ifMatchVersions",
      });
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
    const entries = Object.entries(preconditions);
    // Validate every key and value before touching the database, then read
    // the versions in one batch per entity type instead of per key.
    const wanted = new Map<string, Map<string, number>>();
    for (const [key, expected] of entries) {
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
      let ids = wanted.get(match[1]);
      if (ids === undefined) {
        ids = new Map();
        wanted.set(match[1], ids);
      }
      ids.set(match[2], expected);
    }
    const versions = await entityVersions(tx, boardId, wanted);
    for (const [entity, expectations] of wanted) {
      const actual = versions.get(entity);
      for (const [id, expected] of expectations) {
        const value = actual?.get(id) ?? null;
        if (value === null || value !== expected) {
          throw new ConflictException({
            conflict: "version",
            currentVersion,
          } satisfies ConflictError);
        }
      }
    }
  }

  /**
   * Mirror the reducer's collection guards. A command that would grow a
   * collection past a `LIMITS` bound or a column past its WIP limit is
   * refused with `409 { conflict: "wip" }` — the same `atWipLimit` predicate
   * the client uses. TASK-80: only the `RESTORE_*` family is exempt (undo of
   * a delete); a client-supplied `inverse` flag buys nothing.
   */
  private assertNoWipConflict(
    board: Board,
    action: BoardAction,
    currentVersion: number,
  ): void {
    if (RESTORE_ACTIONS.has(action.type)) return;
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
        const source = cardOf(board, action.cardId);
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
      case "ADD_COLUMN":
      case "DUPLICATE_COLUMN": {
        if (board.columns.length >= LIMITS.columnsPerBoard) reject();
        return;
      }
      case "ADD_LABEL": {
        // A duplicate id is a reducer no-op, not a limit violation.
        if (board.labels.some((label) => label.id === action.label.id)) return;
        if (board.labels.length >= LIMITS.labelsPerBoard) reject();
        return;
      }
      case "SET_CARD_LABEL": {
        if (!action.on) return;
        const card = cardOf(board, action.cardId);
        if (!card || card.labelIds.includes(action.labelId)) return;
        // An unknown label never attaches (the reducer ignores it).
        if (!board.labels.some((label) => label.id === action.labelId)) return;
        if (card.labelIds.length >= LIMITS.labelsPerCard) reject();
        return;
      }
      case "ADD_CARD_LINK": {
        // Only the row cap is refused here. A self-link, an already-linked
        // pair and a `blocks` cycle are guards the *reducer* applies, and
        // the client runs the same reducer before sending — so both sides
        // no-op identically and the states stay equal. Answering 409 for
        // them would turn a harmless race into an error toast; the cap is
        // different, because the user must learn why the link never appeared.
        const card = cardOf(board, action.cardId);
        const target = cardOf(board, action.targetCardId);
        if (!card || !target || card.id === target.id) return;
        if (card.links?.some((link) => link.id === action.linkId)) return;
        if (hasLinkedPair(board.cards, card.id, target.id)) return;
        if (
          wouldCloseBlocksCycle(
            board.cards,
            card.id,
            target.id,
            action.linkType,
          )
        ) {
          return;
        }
        if ((card.links?.length ?? 0) >= LIMITS.linksPerCard) reject();
        return;
      }
      case "ADD_CHECKLIST": {
        const card = cardOf(board, action.cardId);
        if (!card) return;
        const checklists = card.checklists ?? [];
        if (checklists.some((c) => c.id === action.newChecklistId)) return;
        if (checklists.length >= LIMITS.checklistsPerCard) reject();
        return;
      }
      case "ADD_CHECKLIST_ITEM": {
        const card = cardOf(board, action.cardId);
        if (!card) return;
        const items =
          card.checklists?.find((c) => c.id === action.checklistId)?.items ??
          [];
        if (items.some((item) => item.id === action.newItemId)) return;
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

/** Upper bound on the `ifMatchVersions` map a single command may carry (B1). */
const MAX_IF_MATCH_VERSIONS = 100;

/**
 * Current `version` of every `touch` target the command pins, grouped by
 * entity type and fetched in at most one query per type (B1). Scoped to the
 * board so `ifMatchVersions` cannot be used as a version oracle for entities
 * on boards the caller is not a member of — a foreign id reads as absent.
 */
async function entityVersions(
  tx: Prisma.TransactionClient,
  boardId: string,
  wanted: Map<string, Map<string, number>>,
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  const select = { id: true, version: true } as const;
  const put = (
    entity: string,
    rows: Array<{ id: string; version: number }>,
  ): void => {
    const map = new Map<string, number>();
    for (const row of rows) map.set(row.id, row.version);
    out.set(entity, map);
  };
  const idsOf = (entity: string): string[] => [
    ...(wanted.get(entity)?.keys() ?? []),
  ];

  if (wanted.has("board")) {
    const row = await tx.board.findFirst({ where: { id: boardId }, select });
    put("board", row ? [row] : []);
  }
  if (wanted.has("column")) {
    put(
      "column",
      await tx.column.findMany({
        where: { boardId, id: { in: idsOf("column") } },
        select,
      }),
    );
  }
  if (wanted.has("card")) {
    put(
      "card",
      await tx.card.findMany({
        where: { column: { boardId }, id: { in: idsOf("card") } },
        select,
      }),
    );
  }
  if (wanted.has("label")) {
    put(
      "label",
      await tx.label.findMany({
        where: { boardId, id: { in: idsOf("label") } },
        select,
      }),
    );
  }
  if (wanted.has("checklist")) {
    put(
      "checklist",
      await tx.checklist.findMany({
        where: {
          card: { column: { boardId } },
          id: { in: idsOf("checklist") },
        },
        select,
      }),
    );
  }
  if (wanted.has("checklistItem")) {
    put(
      "checklistItem",
      await tx.checklistItem.findMany({
        where: {
          checklist: { card: { column: { boardId } } },
          id: { in: idsOf("checklistItem") },
        },
        select,
      }),
    );
  }
  return out;
}

/**
 * Stable identity of an action for the idempotency check: canonical JSON
 * without `at` (the client clock is not part of *what* the command does, and
 * the stored copy may carry the server-clamped value).
 */
function actionFingerprint(action: unknown): string {
  if (action === null || typeof action !== "object") {
    return stableStringify(action);
  }
  const rest: Record<string, unknown> = {
    ...(jsonSafe(action) as Record<string, unknown>),
  };
  delete rest.at;
  return stableStringify(rest);
}

/** B-5: replace an `at` outside the trusted skew window with server time. */
function clampActionAt<T extends BoardAction>(action: T, now: number): T {
  const at = (action as { at?: unknown }).at;
  if (typeof at !== "number") return action;
  if (Number.isFinite(at) && Math.abs(at - now) <= COMMAND_AT_MAX_SKEW_MS) {
    return action;
  }
  return { ...action, at: now };
}

/** Field names whose numeric values the writers turn into `Date`s. */
const DATE_FIELD = /^(at|dueDate|[a-z]+At)$/;

/**
 * Every timestamp in the payload (`dueDate`, `RESTORE_*` snapshots'
 * `createdAt`/`updatedAt`/…) must be a representable Date — `new Date(1e300)`
 * is Invalid Date and would surface as a Prisma 500 instead of a 400. `at`
 * itself is clamped afterwards; here it only has to be finite.
 */
function assertDatesInRange(action: unknown): void {
  const visit = (value: unknown, path: string, depth: number): void => {
    if (depth > 8 || value === null || typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value)) {
      const field = Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`;
      if (
        typeof entry === "number" &&
        DATE_FIELD.test(key) &&
        !(Number.isFinite(entry) && Math.abs(entry) <= MAX_DATE_MS)
      ) {
        throw new BadRequestException({
          message: `Invalid command (${field}): must be a valid timestamp`,
          field,
        });
      }
      visit(entry, field, depth + 1);
    }
  };
  visit(action, "action", 0);
}
