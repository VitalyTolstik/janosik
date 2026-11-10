import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Role } from "@prisma/client";
import type { ApprovalRequest, Prisma } from "@prisma/client";
import type {
  ActorType,
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
  evaluateCardTransition,
  evaluateTransition,
  hasLinkedPair,
  LIMITS,
  workflowReferenceError,
  wouldCloseBlocksCycle,
} from "@janosik/shared";
import type {
  BoardRole,
  WorkflowConflictDetails,
  WorkflowDecision,
} from "@janosik/shared";
import { ApprovalsService } from "@/approvals/approvals.service";
import {
  approvalPlanHash,
  classifyPlan,
  planFromPreparedCommands,
  type PlanRequirement,
} from "@/approvals/approval-plan";
import { loadBoardAggregate } from "@/boards/board-aggregate";
import { PrismaService } from "@/common/prisma/prisma.service";
import { BoardWriteService } from "@/common/board-write.service";
import { activeMembershipWhere } from "@/common/membership";
import type { AuthPrincipal } from "@/auth/auth-principal";
import {
  assertAgentRule,
  classifyCommandAction,
  readBoardAgentPolicy,
} from "@/auth/token-scope";
import { pauseGateFor } from "@/auth/agent-pause";
import {
  type RequestAttribution,
  attributionFields,
  HUMAN_ATTRIBUTION,
} from "@/auth/request-attribution";
import { touchAgentSessionAfterWrite } from "@/agent-sessions/agent-session-context";
import {
  type InternalCommandEvent,
  RealtimeService,
} from "@/realtime/realtime.service";
import { applyCommandWrites, collectVersions } from "./command-writers";
import { commandDetails } from "./command-details";
import {
  actionFingerprint,
  jsonSafe,
  prepareCommandDto,
  type PreparedCommand,
} from "./command-validation";
import { referencedEntityIds } from "./referenced-entity-ids";
import type { CreateCommandDto } from "./dto/create-command.dto";

export {
  COMMAND_AT_MAX_SKEW_MS,
  MAX_COMMAND_BYTES_INTERNAL,
  actionFingerprint,
} from "./command-validation";

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
    private readonly approvals: ApprovalsService,
  ) {}

  /**
   * Apply one command idempotently, or return its stored result on replay.
   * A thin wrapper over {@link applyBatch} of one, so the single and the
   * batched transports share one code path (TASK-160).
   */
  async apply(
    boardId: string,
    actorId: string,
    dto: CreateCommandDto,
    options: {
      allowOversize?: boolean;
      actorType?: ActorType;
      actorRole?: Role;
      /** TASK-166 attribution; the server fills it from the principal. */
      attribution?: RequestAttribution;
      /** TASK-166 scope/destructive gate; only the REST transport passes it. */
      principal?: AuthPrincipal;
      /** TASK-166.5 `X-Approval-Id` for the exact plan being applied. */
      approvalId?: string;
    } = {},
  ): Promise<CommandResponse> {
    const [response] = await this.applyBatch(boardId, actorId, [dto], options);
    return response;
  }

  /**
   * Apply several commands to one board in a single transaction (TASK-160):
   * one board lock, one aggregate load, one set of pre-checks for the whole
   * batch. Commands are applied in order against a running in-memory
   * aggregate, each still writing its own `Command` row — so `seq`,
   * `commandId` idempotency, attribution, undo and the SSE feed are
   * unchanged. All-or-nothing: any command's failure rolls the batch back.
   *
   * `ifMatch`/`ifMatchVersions` are checked at each command's own point in
   * the batch — a client that batches a create with its fields pins the board
   * version on the *first* command only (the later ones see the earlier
   * command's `seq`).
   */
  async applyBatch(
    boardId: string,
    actorId: string,
    dtos: CreateCommandDto[],
    options: {
      allowOversize?: boolean;
      actorType?: ActorType;
      actorRole?: Role;
      /** TASK-166 attribution; the server fills it from the principal. */
      attribution?: RequestAttribution;
      /** TASK-166 scope/destructive gate; only the REST transport passes it. */
      principal?: AuthPrincipal;
      /** TASK-166.5 `X-Approval-Id` for the exact plan being applied. */
      approvalId?: string;
    } = {},
  ): Promise<CommandResponse[]> {
    // TASK-157: who issued the commands — a person or an agent (a PAT). The
    // transport resolves it from the request principal; internal callers
    // (admin restores, the demo seeder) default to "human".
    const actorType: ActorType = options.actorType ?? "human";
    // TASK-166: token/session/run attribution. A request can never carry
    // these fields itself — they are resolved from the auth principal.
    const attribution = options.attribution ?? HUMAN_ATTRIBUTION;
    // The caller's board role drives workflow transitions. A normal command
    // passes the membership role resolved by `MembershipGuard`; internal
    // callers (the master panel, demo seeding) act as an ADMIN.
    const actorRole: Role = options.actorRole ?? Role.ADMIN;
    // Validate every command *before* the board lock (TASK-147 follow-up): an
    // oversized or malformed command is a cheap 400/413, not megabytes
    // serialized through the board writer.
    const prepared = dtos.map((dto) => {
      const entry = this.prepareCommand(boardId, dto, options);
      // TASK-166 (D23): the claim holder is the authenticated actor. A
      // client cannot claim on behalf of another user; token/session fields
      // are written by `command-writers` from the attribution, never from
      // the action payload.
      if (
        entry.action.type === "CLAIM_CARD" &&
        entry.action.claimedBy !== null
      ) {
        entry.action = { ...entry.action, claimedBy: actorId };
        // The stored payload carries the server-normalized holder, so the
        // retry fingerprint must be taken from that same canonical action.
        entry.fingerprint = actionFingerprint(entry.action, boardId);
      }
      return entry;
    });

    // TASK-166.5: classify the whole plan before the board lock. If policy
    // requires approval and the caller sent no `X-Approval-Id`, create the
    // exact request and refuse; the transaction below is then never started,
    // so there is no partial apply. A granted approval is re-checked inside
    // the transaction, where it is consumed atomically with the commands.
    const approvalId =
      options.principal?.via === "pat" ? options.approvalId : undefined;
    const plan = planFromPreparedCommands(boardId, prepared);
    let requirement: PlanRequirement | null = null;
    if (options.principal?.via === "pat") {
      const boardRow = await this.prisma.board.findFirst({
        where: { id: boardId, deletedAt: null },
        select: { agentPolicy: true },
      });
      if (boardRow === null) throw new NotFoundException("Board not found");
      const aggregate = await loadBoardAggregate(this.prisma, boardId);
      if (aggregate === null) throw new NotFoundException("Board not found");
      const policy = readBoardAgentPolicy(boardRow.agentPolicy);
      requirement = classifyPlan(
        plan,
        aggregate,
        policy,
        options.principal.tokenIdentity?.trustedCi === true,
      );
      // Enforce the run limits even when an approval is supplied: an approval
      // authorizes the action, not an oversized plan.
      this.approvals.assertPlanLimits(plan, policy);
      if (approvalId === undefined) {
        await this.approvals.ensureCommandApproval({
          boardId,
          userId: actorId,
          role: actorRole,
          principal: options.principal,
          agentSessionId: attribution.agentSessionId,
          plan,
          requirement,
          policy,
          prepared,
        });
      }
    }

    const applied = await this.boardWrite.run(
      boardId,
      async (
        tx,
      ): Promise<{
        responses: CommandResponse[];
        events: InternalCommandEvent[];
        consumedApproval: ApprovalRequest | null;
      }> => {
        // The board write lock (BoardWriteService) already serializes every
        // command on this board — the `ifMatch` checks below see each
        // committed predecessor. We only need the board to exist.
        const board = await tx.board.findFirst({
          where: { id: boardId, deletedAt: null },
          select: { id: true, agentPolicy: true },
        });
        if (!board) {
          throw new NotFoundException("Board not found");
        }

        let approval: ApprovalRequest | null = null;
        let approvalReplay = false;
        if (approvalId !== undefined && requirement !== null) {
          const authorized = await this.approvals.authorizeCommandApply(tx, {
            boardId,
            approvalId,
            plan,
            planHash: approvalPlanHash(plan),
            requirement,
            principal: options.principal,
            agentSessionId: attribution.agentSessionId,
          });
          approval = authorized.row;
          approvalReplay = authorized.replay;
        }
        let applyAttribution = attribution;
        if (approval !== null && !approvalReplay) {
          const run = await tx.agentRun.create({
            data: {
              boardId,
              apiTokenId: options.principal?.apiTokenId ?? null,
              agentSessionId: attribution.agentSessionId,
              actorId,
              kind: prepared.length > 1 ? "batch" : "single",
              planHash: approvalPlanHash(plan),
              approvalId: approval.id,
              commandCount: prepared.length,
            },
          });
          // Every command of the run carries the id, so the feed and the run
          // detail agree without a second lookup.
          applyAttribution = { ...attribution, runId: run.id };
        }

        // Resolve every `commandId` up front: a retried batch returns the
        // stored results without re-applying (idempotency), and only the
        // *fresh* commands need their ids checked against the entity tables.
        const existingRows = await tx.command.findMany({
          where: { id: { in: prepared.map((entry) => entry.dto.commandId) } },
          select: { id: true, boardId: true, payload: true, result: true },
        });
        const existingById = new Map(existingRows.map((row) => [row.id, row]));
        for (const entry of prepared) {
          const existing = existingById.get(entry.dto.commandId);
          if (!existing) continue;
          if (existing.boardId !== boardId) {
            throw new ConflictException({
              message: "commandId already used on another board",
              field: "commandId",
              code: "id_conflict",
              conflict: "id",
            });
          }
          // A reused key with a different body is a client bug (or a key
          // collision), not a retry: answering with the first command's
          // result would tell the caller its *new* action was applied.
          if (
            actionFingerprint(existing.payload, boardId) !== entry.fingerprint
          ) {
            throw new ConflictException({
              message: "commandId already used with a different payload",
              field: "commandId",
              code: "idempotency_conflict",
            });
          }
        }

        // Entity ids are global primary keys while commands are board-scoped:
        // an id that already lives on another board would be silently
        // rewritten by the upserts below (TASK-30.2). One check covers the
        // whole batch — an id created by an earlier command is still free
        // here and passes; replays are skipped (their stored result must stay
        // reproducible).
        const referenced = new Set<string>();
        for (const entry of prepared) {
          if (existingById.has(entry.dto.commandId)) continue;
          for (const id of referencedEntityIds(entry.action)) {
            referenced.add(id);
          }
        }
        await this.assertIdsBelongToBoard(tx, boardId, [...referenced]);

        let running = await loadBoardAggregate(tx, boardId);
        if (!running) {
          throw new NotFoundException("Board not found");
        }

        const responses: CommandResponse[] = [];
        const events: InternalCommandEvent[] = [];
        for (const entry of prepared) {
          const existing = existingById.get(entry.dto.commandId);
          if (existing) {
            // A replay of an existing `commandId` publishes nothing — that
            // `seq` already went out on the stream.
            responses.push(existing.result as unknown as CommandResponse);
            continue;
          }
          // TASK-166: check the preset and destructive gate at the point the
          // command would run. `running` already includes earlier commands of
          // this batch, so a create + move is judged on the moved card. Any
          // refusal throws inside the board transaction and rolls the whole
          // batch back — there is no partial apply.
          assertAgentRule(
            options.principal,
            board.agentPolicy,
            classifyCommandAction(entry.action, running),
            { approvalApplied: approval !== null },
          );
          const outcome = await this.applyPrepared(tx, {
            boardId,
            actorId,
            actorType,
            actorRole,
            attribution: applyAttribution,
            entry,
            board: running,
          });
          responses.push(outcome.response);
          running = outcome.board;
          // Collected here, published by the caller only after the commit: a
          // subscriber must never replay a command the database could still
          // roll back. `touches` rides along (TASK-30.1) — it is what the
          // command actually wrote, so subscribers mark their undo history
          // foreign without diffing the whole board. `prevSeq` is the board's
          // seq right before this command (B-4), an internal stream hint.
          events.push({
            type: "command",
            seq: outcome.response.seq,
            action: entry.action,
            actorId,
            actorType,
            commandId: entry.dto.commandId,
            touches: outcome.touches,
            prevSeq: outcome.prevSeq,
            ...attributionFields(applyAttribution),
          });
        }

        const runId = applyAttribution.runId;
        if (approval !== null && !approvalReplay && runId !== null) {
          const seqs = responses.map((response) => response.seq);
          await tx.agentRun.update({
            where: { id: runId },
            data: {
              firstSeq: BigInt(Math.min(...seqs)),
              lastSeq: BigInt(Math.max(...seqs)),
            },
          });
          const consumed = await this.approvals.consumeCommandApproval(
            tx,
            approval,
            runId,
            actorId,
            options.principal,
          );
          return { responses, events, consumedApproval: consumed };
        }
        return { responses, events, consumedApproval: null };
      },
      pauseGateFor(options.principal, attribution.agentSessionId),
    );

    if (applied.consumedApproval !== null) {
      this.approvals.publishState(applied.consumedApproval);
    }
    // Publish after the batch committed, in order. A failed batch throws
    // before this, so nothing half-applied is ever announced.
    for (const event of applied.events) {
      this.realtime.publish(boardId, event);
      if (
        event.action.type === "UPDATE_CARD" &&
        event.action.description !== undefined
      ) {
        this.realtime.publish(boardId, {
          type: "activity",
          id: event.commandId ?? String(event.seq),
          boardId,
          actorId,
          at: Date.now(),
          kind: "attachment_updated",
        });
      }
    }
    // A successful PAT write refreshes the session heartbeat at most once a
    // minute (ADR §6.5), but only after the transaction committed.
    await touchAgentSessionAfterWrite(this.prisma, attribution.agentSessionId);
    return applied.responses;
  }

  /**
   * Validate and normalize one command outside the board lock (TASK-160): the
   * size cap, the reducer-shape check, the supported-action check, the date
   * range and the `ifMatchVersions` cap all throw a cheap `4xx` here. The
   * idempotency fingerprint is taken *before* the `at` clamp, so an honest
   * retry (same body, later wall clock) still matches the stored command.
   */
  private prepareCommand(
    boardId: string,
    dto: CreateCommandDto,
    options: { allowOversize?: boolean; approvalId?: string },
  ): PreparedCommand {
    // TASK-147 follow-up: the `ifMatchVersions` cap is enforced HERE, before
    // `boardWrite.run` takes the per-board queue and the advisory lock — an
    // oversized map must be a cheap 400, not 5 MB serialized through the
    // board writer (the in-transaction check stays as defence in depth).
    // The action itself is validated by the shared command-validation
    // helper, so an approval plan and the live transport agree.
    this.assertIfMatchVersionsSize(dto.ifMatchVersions);
    return prepareCommandDto(dto, {
      boardId,
      ...(options.allowOversize === true ? { allowOversize: true } : {}),
      // An approved plan is stored without `at` (it is server context, not
      // intent); applying it stamps the server clock here.
      ...(options.approvalId !== undefined ? { allowMissingAt: true } : {}),
    });
  }

  /**
   * Apply one already-prepared command inside the board-write transaction
   * (TASK-160). `board` is the running aggregate — the loaded board plus the
   * effect of every earlier command in the batch; the returned `board` is the
   * state the next command in the batch sees.
   */
  private async applyPrepared(
    tx: Prisma.TransactionClient,
    params: {
      boardId: string;
      actorId: string;
      actorType: ActorType;
      actorRole: Role;
      attribution: RequestAttribution;
      entry: PreparedCommand;
      board: Board;
    },
  ): Promise<{
    response: CommandResponse;
    touches: string[];
    prevSeq: number;
    board: Board;
  }> {
    const {
      boardId,
      actorId,
      actorType,
      actorRole,
      attribution,
      entry,
      board,
    } = params;
    const { dto, action } = entry;

    await this.assertAssigneeIsBoardMember(tx, boardId, action);
    await this.assertClaimIsFree(tx, boardId, action, attribution);

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
    // Workflow first: a forbidden transition must report its own reason, not
    // hide behind a WIP refusal in the same destination. Recovery commands
    // (unarchive / restore) change a card's column too, so they run the same
    // role and condition checks against the column the card came from.
    await this.assertWorkflowTransition(
      tx,
      boardId,
      board,
      action,
      actorRole,
      currentVersion,
    );
    this.assertWorkflowReferences(board, action);
    this.assertNoWipConflict(board, action, currentVersion);

    const at = (action as BoardScopedAction).at;
    const state = boardReducer(
      [board],
      Object.assign({}, action, { boardId }) as BoardAction,
      { withActivity: false },
    );
    const after = state[0] ?? board;
    const changed = stableStringify(board) !== stableStringify(after);
    // A create followed by field edits must not turn a duplicate or invalid
    // ADD_CARD into edits of an existing card. Reject before writing any
    // command row so the whole batch rolls back. A genuine commandId replay
    // is handled above and never reaches this branch.
    if (!changed && action.type === "ADD_CARD") {
      throw new BadRequestException({
        message: "Card was not created; check the column and card ids",
        field: "action.newCardId",
      });
    }
    // Freeze the display diff while both aggregates are in hand (TASK-37)
    // — the history feed reads it back; the payload stays a pure action.
    const details = changed ? commandDetails(action, board, after) : null;

    const created = await tx.command.create({
      data: {
        id: dto.commandId,
        boardId,
        actorId,
        actorType,
        apiTokenId: attribution.apiTokenId,
        agentSessionId: attribution.agentSessionId,
        runId: attribution.runId,
        agentName: attribution.agentName,
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
        before: board,
        after,
        at,
        actorId,
        apiTokenId: attribution.apiTokenId,
        agentSessionId: attribution.agentSessionId,
      });
    }
    const versions = changed ? await collectVersions(tx, boardId, touches) : {};
    const response: CommandResponse = { seq, versions };

    await tx.command.update({
      where: { id: created.id },
      data: {
        payload: jsonSafe(action),
        result: jsonSafe(response),
        touches,
      },
    });
    return { response, touches, prevSeq: currentVersion, board: after };
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
    filters: {
      runId?: string;
      apiTokenId?: string;
      agentSessionId?: string;
    } = {},
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
        ...(filters.runId !== undefined ? { runId: filters.runId } : {}),
        ...(filters.apiTokenId !== undefined
          ? { apiTokenId: filters.apiTokenId }
          : {}),
        ...(filters.agentSessionId !== undefined
          ? { agentSessionId: filters.agentSessionId }
          : {}),
      },
      orderBy: { seq: "asc" },
      // One extra row tells "exactly max" apart from "more than max".
      take: max + 1,
      select: {
        id: true,
        seq: true,
        actorId: true,
        actorType: true,
        apiTokenId: true,
        agentSessionId: true,
        runId: true,
        agentName: true,
        payload: true,
        touches: true,
      },
    });
    const truncated = rows.length > max;
    return {
      entries: (truncated ? rows.slice(0, max) : rows).map((row) => ({
        seq: Number(row.seq),
        // Rows written before ingress stamping may lack `boardId`; replay them
        // scoped to the queried board so the UI's realtime bridge keeps them.
        action: {
          ...(row.payload as Record<string, unknown>),
          boardId,
        } as BoardAction,
        actorId: row.actorId,
        actorType: row.actorType as ActorType,
        commandId: row.id,
        touches: row.touches,
        ...attributionFields({
          apiTokenId: row.apiTokenId,
          agentSessionId: row.agentSessionId,
          runId: row.runId,
          agentName: row.agentName,
        }),
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
    attribution: RequestAttribution,
  ): Promise<void> {
    if (action.type !== "CLAIM_CARD") return;
    if (action.claimedBy === null || action.leaseUntil === null) return;
    const card = await tx.card.findFirst({
      where: { id: action.cardId, column: { boardId } },
      select: {
        claimedBy: true,
        claimedByTokenId: true,
        claimedBySessionId: true,
        leaseUntil: true,
      },
    });
    if (
      !card ||
      card.claimedBy === null ||
      card.leaseUntil === null ||
      card.leaseUntil.getTime() <= Date.now()
    ) {
      return;
    }
    // TASK-166 (D23): compare the session first, then the token, then the
    // legacy user id. Two PATs of one owner are different claim holders.
    const sameHolder =
      card.claimedBySessionId !== null
        ? card.claimedBySessionId === attribution.agentSessionId
        : card.claimedByTokenId !== null
          ? card.claimedByTokenId === attribution.apiTokenId
          : card.claimedBy === action.claimedBy;
    if (!sameHolder) {
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
    if (
      actionType !== "ARCHIVE_BOARD" &&
      actionType !== "UNARCHIVE_BOARD" &&
      actionType !== "SET_BOARD_WORKFLOW"
    ) {
      return;
    }
    const membership = await tx.boardMember.findUnique({
      where: { boardId_userId: { boardId, userId: actorId } },
      select: { role: true },
    });
    if (membership?.role !== Role.ADMIN) {
      throw new ForbiddenException(
        actionType === "SET_BOARD_WORKFLOW"
          ? "Only an ADMIN can change the board workflow"
          : "Only an ADMIN can archive or unarchive the board",
      );
    }
  }

  /**
   * Enforce the board's workflow for every command that changes a card's
   * column (TASK-165 review). Runs inside the board-write transaction, after
   * the board lock, so the config, the card's actual column, the caller's
   * role and WIP all describe the same instant.
   *
   * `MOVE_CARD` uses the aggregate as the source and does not trust
   * `action.fromColumnId`; on a workflow board a stale source is a version
   * conflict (legacy boards keep the reducer's historical no-op).
   * `UNARCHIVE_CARD` and `RESTORE_CARD` recover a card whose DB row still
   * points at its original column, so they are checked from that column —
   * a MEMBER cannot use recovery to skip a missing edge, a role rule or a
   * card-field condition. A card with no pre-existing row is a create, and
   * creation in any column is deliberately unrestricted.
   */
  private async assertWorkflowTransition(
    tx: Prisma.TransactionClient,
    boardId: string,
    board: Board,
    action: BoardAction,
    actorRole: Role,
    currentVersion: number,
  ): Promise<void> {
    let fromColumnId: string | undefined;
    let toColumnId: string | undefined;
    let card = "cardId" in action ? cardOf(board, action.cardId) : undefined;

    if (action.type === "MOVE_CARD") {
      if (!card || card.archivedAt !== undefined) return;
      const from = board.columns.find((column) =>
        column.cardIds.includes(action.cardId),
      );
      if (!from) return;
      if (from.id !== action.fromColumnId) {
        // A workflow move built on a stale source would otherwise be a 200
        // no-op while the client keeps its optimistic position. Refuse it as
        // a version conflict so the client rolls back and re-reads; legacy
        // boards keep the reducer's historical no-op.
        if (board.workflow?.enabled) {
          throw new ConflictException({
            conflict: "version",
            currentVersion,
          } satisfies ConflictError);
        }
        return;
      }
      fromColumnId = from.id;
      toColumnId = action.toColumnId;
    } else if (action.type === "UNARCHIVE_CARD") {
      if (!card || card.archivedAt === undefined) return;
      fromColumnId = await this.recoverySourceColumn(
        tx,
        boardId,
        action.cardId,
      );
      toColumnId = action.columnId ?? board.columns[0]?.id;
    } else if (action.type === "RESTORE_CARD") {
      // A column-less restore recreates the archived state, and restoring an
      // archived snapshot into a column is a reducer no-op.
      if (action.columnId === undefined) return;
      if (action.card.archivedAt !== undefined) return;
      card = action.card;
      fromColumnId = await this.recoverySourceColumn(
        tx,
        boardId,
        action.card.id,
      );
      toColumnId = action.columnId;
    } else {
      return;
    }

    if (fromColumnId === undefined || toColumnId === undefined) return;
    // The original column was deleted: there is no status to enforce, so a
    // recovery into a live column is allowed (deleting a column is ADMIN-only).
    if (!board.columns.some((column) => column.id === fromColumnId)) return;
    const to = board.columns.find((column) => column.id === toColumnId);
    if (!to || fromColumnId === to.id) return;
    if (!card) return;

    let decision: WorkflowDecision;
    let allowedToColumnIds: string[];
    if (action.type === "MOVE_CARD") {
      const move = evaluateTransition(
        board,
        action.cardId,
        action.toColumnId,
        actorRole as BoardRole,
      );
      decision = move;
      allowedToColumnIds = move.allowedToColumnIds;
    } else {
      decision = evaluateCardTransition(
        board.workflow,
        card,
        fromColumnId,
        to.id,
        actorRole as BoardRole,
      );
      allowedToColumnIds = board.columns
        .filter((column) => column.id !== fromColumnId)
        .filter(
          (column) =>
            evaluateCardTransition(
              board.workflow,
              card,
              fromColumnId,
              column.id,
              actorRole as BoardRole,
            ).allowed,
        )
        .map((column) => column.id);
    }
    if (decision.allowed) return;
    if (decision.code === "card_not_found") return;
    const workflow: WorkflowConflictDetails = {
      code: decision.code,
      fromColumnId: decision.fromColumnId,
      toColumnId: decision.toColumnId,
      allowedToColumnIds,
      ...(decision.code === "role_not_allowed" && decision.requiredRoles
        ? { requiredRoles: decision.requiredRoles }
        : {}),
      ...(decision.code === "condition_failed"
        ? { failedConditions: decision.failedConditions }
        : {}),
    };
    throw new ConflictException({
      conflict: "workflow",
      currentVersion,
      workflow,
    } satisfies ConflictError);
  }

  /** The column a soft-deleted or archived card came from, if still known. */
  private async recoverySourceColumn(
    tx: Prisma.TransactionClient,
    boardId: string,
    cardId: string,
  ): Promise<string | undefined> {
    const row = await tx.card.findFirst({
      where: { id: cardId, column: { boardId } },
      select: { columnId: true, archivedFromColumnId: true },
    });
    // A deleted source column leaves the internal orphan in `columnId`; the
    // persisted archive source stays valid (and is absent from the board, so
    // the caller treats it as a deleted-column recovery).
    return row?.archivedFromColumnId ?? row?.columnId;
  }

  /**
   * A workflow command may only name columns the board actually has. Shape is
   * validated on the wire; this is the reference check that needs the board,
   * so it runs under the lock. An enabled workflow also needs two columns —
   * there is nothing to restrict on a one-column board.
   */
  private assertWorkflowReferences(board: Board, action: BoardAction): void {
    if (action.type !== "SET_BOARD_WORKFLOW" || action.workflow === undefined) {
      return;
    }
    const problem = workflowReferenceError(action.workflow, board.columns);
    if (problem) {
      throw new BadRequestException({
        message: `Invalid workflow (${problem.field}): ${problem.message}`,
        field: `action.${problem.field}`,
      });
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
