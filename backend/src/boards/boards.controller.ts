import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { type BoardMember, Role } from "@prisma/client";
import type {
  BoardAgentPolicyStateDto,
  BoardAggregate,
  BoardCardDetailDto,
  BoardCardDetailsDto,
  BoardCardPageDto,
  BoardCardSearchResult,
  BoardImportPreviewDto,
  BoardMemberDto,
  BoardSummary,
  BoardsReadyDto,
  DeletedBoardItemsDto,
  LabelAssignment,
  WorkspaceSearchResult,
} from "@janosik/shared";
import {
  BOARD_CARD_DETAIL_BATCH_MAX,
  BOARD_CARD_PAGE_LIMIT_DEFAULT,
  BOARD_CARD_PAGE_LIMIT_MAX,
  BOARD_READ_MODEL_HEADER,
  BOARD_READ_MODEL_VERSION,
  READY_WORK_LIMIT_DEFAULT,
  READY_WORK_LIMIT_MAX,
  READY_WORK_WAIT_MAX_MS,
} from "@janosik/shared";
import type { AuthUser } from "@/auth/auth.types";
import type { AgentSessionContext, AuthPrincipal } from "@/auth/auth-principal";
import {
  actorTypeOf,
  CurrentAgentSession,
  CurrentPrincipal,
  SessionOnlyGuard,
} from "@/auth/auth-principal";
import { requestAttribution } from "@/auth/request-attribution";
import { assertAccountWidePreset } from "@/auth/token-scope";
import { TokenScope } from "@/auth/token-scope.decorator";
import { CurrentUser } from "@/auth/current-user.decorator";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import { BoardRoles } from "@/common/board-roles.decorator";
import {
  BOARD_FULL_PROJECTION,
  BOARD_READ_ROUTE,
  BoardReadService,
  type BoardReadDeps,
  type BoardReadRequest,
  type BoardReadResponse,
} from "@/common/board-read.service";
import { CurrentMembership } from "@/common/current-membership.decorator";
import {
  hashIdempotentRequest,
  idempotencyActorKey,
  IdempotencyService,
  normalizeIdempotencyKey,
} from "@/common/idempotency.service";
import { MembershipGuard } from "@/common/membership.guard";
import { ApprovalsService } from "@/approvals/approvals.service";
import { plainRecord } from "@/approvals/approval-plan";
import { CommandsService } from "@/commands/commands.service";
import { markGuaranteedRollback } from "@/common/rollback-certainty";
import { boardStarterCommands } from "./board-starter";
import { BoardsService } from "./boards.service";
import { DeletedItemsService } from "./deleted-items.service";
import { ReadyService } from "./ready.service";
import {
  BOARD_CARD_DETAIL_ROUTE,
  BOARD_CARDS_ROUTE,
  BOARD_SUMMARY_ROUTE,
  BoardReadModelService,
  boardCardDetailProjection,
  boardCardDetailsProjection,
  boardPageProjection,
  boardSummaryProjection,
} from "./board-read-model";
import { UpdateBoardAgentPolicyDto } from "./dto/agent-policy.dto";
import { CreateBoardDto } from "./dto/create-board.dto";
import { InviteMemberDto } from "./dto/invite-member.dto";
import { UpdateMemberDto } from "./dto/update-member.dto";

/**
 * Search `q` must be a single string. Express turns `?q=a&q=b` into an
 * array; answering 400 keeps the service contract (and the length bound)
 * honest instead of coercing arbitrary input (TASK-177.13 review).
 */
function searchQuery(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value !== "string") {
    throw new BadRequestException("q must be a single string");
  }
  return value;
}

/** `includeMatches` defaults to true; only explicit false values opt out. */
function includeMatches(value: unknown): boolean {
  if (value === undefined) return true;
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  throw new BadRequestException("includeMatches must be 0, 1, false or true");
}

/**
 * Parse one numeric ready-work query parameter. Every value is a plain
 * non-negative decimal integer; a repeated parameter, a sign, a fraction or
 * whitespace is a `400` rather than a silently coerced bound.
 */
function intQuery(
  name: string,
  value: unknown,
  options: { min: number; max?: number; fallback: number },
): number {
  if (value === undefined) return options.fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new BadRequestException(`${name} must be a non-negative integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < options.min) {
    throw new BadRequestException(
      `${name} must be an integer from ${options.min}${
        options.max === undefined ? "" : ` to ${options.max}`
      }`,
    );
  }
  if (options.max !== undefined && parsed > options.max) {
    throw new BadRequestException(
      `${name} must be an integer from ${options.min} to ${options.max}`,
    );
  }
  return parsed;
}

/** Single, non-empty string query parameter (repeated arrays are rejected). */
function stringQuery(name: string, value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw new BadRequestException(`${name} must be a non-empty string`);
  }
  return value;
}

/** Strict `1/0/true/false` flag; anything else is a `400`. */
function parseBoolean(name: string, value: unknown): boolean {
  if (value === undefined) return false;
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  throw new BadRequestException(`${name} must be 0, 1, false or true`);
}

/** Comma-separated card ids for the bounded preimage batch. */
function parseIds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw new BadRequestException("ids must be a comma-separated card id list");
  }
  const ids = value.split(",");
  if (ids.length > BOARD_CARD_DETAIL_BATCH_MAX) {
    throw new BadRequestException(
      `ids accepts at most ${BOARD_CARD_DETAIL_BATCH_MAX} card ids`,
    );
  }
  for (const id of ids) {
    if (id.length === 0 || id.length > 200) {
      throw new BadRequestException("ids contains a malformed card id");
    }
  }
  return ids;
}

/**
 * Boards + membership REST surface (§7.4).
 *
 * Content mutations (columns/cards/labels/checklists) are NOT here — they
 * travel through the command log in TASK-26. `MembershipGuard` resolves the
 * board from `:id`, checks membership/expiry and enforces `@BoardRoles()`.
 */
@Controller("boards")
export class BoardsController {
  constructor(
    private readonly boards: BoardsService,
    private readonly deletedItems: DeletedItemsService,
    private readonly approvals: ApprovalsService,
    private readonly idempotency: IdempotencyService,
    private readonly commands: CommandsService,
    private readonly boardRead: BoardReadService,
    private readonly readModel: BoardReadModelService,
    private readonly ready: ReadyService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
  ): Promise<BoardSummary[]> {
    const summaries = await this.boards.listBoards(user.id);
    // A board-scoped PAT sees only its board (TASK-157).
    const scope = principal?.tokenScope?.boardId;
    return scope ? summaries.filter((board) => board.id === scope) : summaries;
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @Body() dto: CreateBoardDto,
    @Headers("idempotency-key") rawKey?: string,
  ): Promise<BoardAggregate> {
    // Board creation is account-wide `admin` (TASK-166): a board-scoped or
    // worker/reviewer token cannot mint boards outside its mandate.
    assertAccountWidePreset(principal, "board.create");
    if (dto.template !== "starter" && dto.templateLocale !== undefined) {
      throw new BadRequestException({
        message: "templateLocale requires template=starter",
        field: "templateLocale",
      });
    }
    const outcome = await this.idempotency.run({
      scope: "create_board",
      key: normalizeIdempotencyKey(rawKey),
      actorKey: idempotencyActorKey(user.id, principal),
      requestHash: hashIdempotentRequest({
        title: dto.title,
        // Old clients that omit the template keep their previous hash.
        ...(dto.template
          ? { template: dto.template, locale: dto.templateLocale ?? "en" }
          : {}),
      }),
      run: async () => {
        const board = await this.boards.createBoard(user.id, dto, principal);
        if (dto.template !== "starter") {
          return { body: board, status: 201, resourceId: board.id };
        }
        // The starter is ordinary content, so it goes through the command log
        // as one all-or-nothing batch created by the new board's ADMIN. It is
        // a separate transaction from the board insert, so a failure must
        // remove that freshly created board before the idempotency key is
        // released — otherwise an automatic 503/504 retry duplicates the board.
        try {
          await this.commands.applyBatch(
            board.id,
            user.id,
            boardStarterCommands(board.id, dto.templateLocale ?? "en"),
            {
              actorType: actorTypeOf(principal),
              attribution: requestAttribution(principal),
              principal,
              ...(principal?.via === "pat"
                ? { run: { kind: "batch" as const } }
                : {}),
            },
          );
        } catch (error) {
          const cleaned = await this.boards.discardFreshBoard(board.id);
          if (!cleaned) {
            // The empty board may still exist: keep the idempotency record so
            // a same-key retry cannot create a second one.
            throw new ServiceUnavailableException({
              message:
                "The board was created, but the example could not be completed; open it from details.boardId",
              code: "starter_cleanup_failed",
              retryable: false,
              boardId: board.id,
            });
          }
          // The board is gone, so this key may safely run again.
          markGuaranteedRollback(error);
          throw error;
        }
        // The starter committed. A failed read is ambiguous (the board
        // exists), so retry briefly and otherwise keep the idempotency record
        // and ask for the same request rather than inviting a second board.
        let withStarter: BoardAggregate | null = null;
        for (
          let attempt = 1;
          attempt <= 3 && withStarter === null;
          attempt += 1
        ) {
          try {
            withStarter = await this.boards.getAggregate(board.id);
          } catch {
            if (attempt === 3) {
              throw new ServiceUnavailableException({
                message: "The board was created; open it from details.boardId",
                code: "starter_read_failed",
                retryable: false,
                boardId: board.id,
              });
            }
            await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
          }
        }
        return { body: withStarter!, status: 201, resourceId: board.id };
      },
    });
    return outcome.body;
  }

  @UseGuards(JwtAuthGuard)
  @Post("import")
  async import(
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @Body() body: unknown,
    @Query("dryRun") dryRun?: string,
    @Headers("idempotency-key") rawKey?: string,
  ): Promise<BoardAggregate[] | BoardImportPreviewDto> {
    assertAccountWidePreset(principal, "board.import");
    const preview = dryRun === "1" || dryRun === "true";
    if (preview) {
      return this.boards.previewImport(user.id, body);
    }
    const outcome = await this.idempotency.run({
      scope: "import_boards",
      key: normalizeIdempotencyKey(rawKey),
      actorKey: idempotencyActorKey(user.id, principal),
      requestHash: hashIdempotentRequest(body),
      run: async () => {
        const boards = await this.boards.importBoards(user.id, body, principal);
        return {
          body: boards,
          status: 201,
          resourceId: boards[0]?.id ?? null,
        };
      },
    });
    return outcome.body;
  }

  /**
   * Comment/attachment search across the caller's boards (TASK-177.13).
   * Declared before `:id` so `/boards/search` is not read as a board id.
   * Authenticated users only; the service scopes the query to active
   * memberships and to a board-scoped PAT's own board.
   */
  @UseGuards(JwtAuthGuard)
  @Get("search")
  searchAcrossBoards(
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @Query("q") q?: unknown,
  ): Promise<WorkspaceSearchResult> {
    return this.boards.searchMatchesAcrossBoards(
      user.id,
      searchQuery(q),
      principal?.tokenScope?.boardId,
    );
  }

  /**
   * TASK-200.2: cross-board ready snapshot without an N+1 read. Declared
   * before `:id` so `/boards/ready` is not parsed as a board id. A
   * board-scoped PAT sees only its board, matching `GET /boards`.
   */
  @UseGuards(JwtAuthGuard)
  @Get("ready")
  @Header("Cache-Control", "no-store")
  listReady(
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @Query("limit") limitRaw?: unknown,
  ): Promise<BoardsReadyDto> {
    const limit = intQuery("limit", limitRaw, {
      min: 1,
      max: READY_WORK_LIMIT_MAX,
      fallback: READY_WORK_LIMIT_DEFAULT,
    });
    return this.ready.listReadyForUser(
      user.id,
      principal?.tokenScope?.boardId ?? undefined,
      limit,
    );
  }

  /**
   * TASK-200.2: ready cards for one board, optionally held as a long-poll.
   * Any accepted role may read it (VIEWER included). `wait` is milliseconds
   * and bounded by `READY_WORK_WAIT_MAX_MS`; a hold that times out answers
   * `204` with no body but still carries `X-Board-Seq` and
   * `Cache-Control: no-store`. `since` is the last observed `seq`: a changed
   * board answers immediately even when no card is ready. After a relevant
   * wake with no ready card the request keeps holding, so an empty post-wake
   * `200` cannot trigger a re-poll storm. The response is a summary only —
   * never a board aggregate.
   *
   * The abort signal fires when the client disconnects, so a closed agent
   * connection never leaves a realtime subscription or held-poll slot behind.
   */
  @UseGuards(MembershipGuard)
  @Get(":id/ready")
  async readyCards(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Query("limit") limitRaw: unknown,
    @Query("wait") waitRaw: unknown,
    @Query("since") sinceRaw: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const limit = intQuery("limit", limitRaw, {
      min: 1,
      max: READY_WORK_LIMIT_MAX,
      fallback: READY_WORK_LIMIT_DEFAULT,
    });
    const wait = intQuery("wait", waitRaw, {
      min: 0,
      max: READY_WORK_WAIT_MAX_MS,
      fallback: 0,
    });
    const since =
      sinceRaw === undefined
        ? undefined
        : intQuery("since", sinceRaw, { min: 0, fallback: 0 });

    const controller = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) controller.abort();
    };
    req.on("aborted", onClose);
    res.on("close", onClose);
    try {
      const result = await this.ready.getBoardReady(id, {
        userId: user.id,
        limit,
        wait,
        since,
        signal: controller.signal,
      });
      if (result.status === "aborted") return;
      res.setHeader("Cache-Control", "no-store");
      if (result.held) res.setHeader("X-Ready-Held", "1");
      if (result.status === "timeout") {
        res.setHeader("X-Board-Seq", String(result.seq));
        if (!res.headersSent && !res.destroyed) {
          res.status(HttpStatus.NO_CONTENT).end();
        }
        return;
      }
      res.setHeader("X-Board-Seq", String(result.body.seq));
      res.status(HttpStatus.OK).json(result.body);
    } finally {
      req.off("aborted", onClose);
      res.off("close", onClose);
    }
  }

  /**
   * TASK-200.9: the initial read-model view. Columns with complete id order
   * and counts, labels, archived ids and a bounded first page per column.
   * The body never carries a description, checklist or link row.
   */
  @UseGuards(MembershipGuard)
  @Get(":id/summary")
  async summary(
    @Param("id") id: string,
    @CurrentMembership() membership: BoardMember,
    @Query("limit") limitRaw: unknown,
    @Headers("accept-encoding") acceptEncoding: string | undefined,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const limit = intQuery("limit", limitRaw, {
      min: 1,
      max: BOARD_CARD_PAGE_LIMIT_MAX,
      fallback: BOARD_CARD_PAGE_LIMIT_DEFAULT,
    });
    await this.sendRead(res, {
      request: {
        boardId: id,
        role: membership.role,
        projection: boardSummaryProjection(limit),
        route: BOARD_SUMMARY_ROUTE,
        acceptEncoding,
        ifNoneMatch,
      },
      deps: {
        stamp: (budget) => this.boards.getReadStamp(id, budget),
        build: async (budget) => {
          const body = await this.readModel.summary(
            id,
            membership.role,
            limit,
            budget,
          );
          return {
            body,
            seq: body.seq,
            revision: BigInt(body.aggregateRevision),
          };
        },
      },
      projection: BOARD_READ_MODEL_VERSION,
    });
  }

  /**
   * TASK-200.9: bounded summary pages. `columnId` pages one column in keyset
   * order; `archived=1` pages the board-wide archive. A batch `ids=` read is
   * the only list route that can return full cards (`detail=full`, ≤50) — it
   * exists for undo preimages, not for normal rendering.
   */
  @UseGuards(MembershipGuard)
  @Get(":id/cards")
  async cards(
    @Param("id") id: string,
    @CurrentMembership() membership: BoardMember,
    @Query("columnId") columnIdRaw: unknown,
    @Query("archived") archivedRaw: unknown,
    @Query("cursor") cursorRaw: unknown,
    @Query("limit") limitRaw: unknown,
    @Query("ids") idsRaw: unknown,
    @Query("detail") detailRaw: unknown,
    @Headers("accept-encoding") acceptEncoding: string | undefined,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const archived = parseBoolean("archived", archivedRaw);
    const cursor = stringQuery("cursor", cursorRaw);
    const limit = intQuery("limit", limitRaw, {
      min: 1,
      max: BOARD_CARD_PAGE_LIMIT_MAX,
      fallback: BOARD_CARD_PAGE_LIMIT_DEFAULT,
    });
    const ids = parseIds(idsRaw);
    const detail = stringQuery("detail", detailRaw) ?? "summary";
    if (detail !== "summary" && detail !== "full") {
      throw new BadRequestException("detail must be summary or full");
    }
    if (ids !== undefined) {
      if (columnIdRaw !== undefined || archivedRaw !== undefined) {
        throw new BadRequestException(
          "ids cannot be combined with columnId or archived",
        );
      }
      if (detail !== "full") {
        throw new BadRequestException("ids requires detail=full");
      }
      await this.sendRead(res, {
        request: {
          boardId: id,
          role: membership.role,
          projection: boardCardDetailsProjection(ids),
          route: BOARD_CARDS_ROUTE,
          acceptEncoding,
          ifNoneMatch,
          precheck: () => this.readModel.assertCardsInBoard(id, ids),
        },
        deps: {
          stamp: (budget) => this.boards.getReadStamp(id, budget),
          build: async (budget) => {
            const body: BoardCardDetailsDto = await this.readModel.detailsByIds(
              id,
              ids,
              budget,
            );
            return {
              body,
              seq: body.seq,
              revision: BigInt(body.aggregateRevision),
            };
          },
        },
        projection: BOARD_READ_MODEL_VERSION,
      });
      return;
    }
    if (detail !== "summary") {
      throw new BadRequestException("detail=full requires ids");
    }
    const columnId = stringQuery("columnId", columnIdRaw);
    if (archived && columnId !== undefined) {
      throw new BadRequestException(
        "columnId and archived are mutually exclusive",
      );
    }
    if (!archived && columnId === undefined) {
      throw new BadRequestException("columnId or archived=1 is required");
    }
    await this.sendRead(res, {
      request: {
        boardId: id,
        role: membership.role,
        projection: boardPageProjection({
          columnId: columnId ?? null,
          archived,
          cursor,
          limit,
        }),
        route: BOARD_CARDS_ROUTE,
        acceptEncoding,
        ifNoneMatch,
        ...(columnId !== undefined
          ? {
              precheck: () => this.readModel.assertColumnInBoard(id, columnId),
            }
          : {}),
      },
      deps: {
        stamp: (budget) => this.boards.getReadStamp(id, budget),
        build: async (budget) => {
          const body: BoardCardPageDto = await this.readModel.page(
            id,
            { columnId: columnId ?? null, archived, cursor, limit },
            budget,
          );
          return {
            body,
            seq: body.seq,
            revision: BigInt(body.aggregateRevision),
          };
        },
      },
      projection: BOARD_READ_MODEL_VERSION,
    });
  }

  /**
   * TASK-200.9: complete label assignment preimage for an undoable
   * DELETE_LABEL. It is not a board read and carries no card content.
   */
  @UseGuards(MembershipGuard)
  @Get(":id/labels/:labelId/assignments")
  @Header("Cache-Control", "no-store")
  labelAssignments(
    @Param("id") id: string,
    @Param("labelId") labelId: string,
  ): Promise<LabelAssignment[]> {
    return this.readModel.labelAssignments(id, labelId);
  }

  /** TASK-200.9: one full card (description, checklists, links). */
  @UseGuards(MembershipGuard)
  @Get(":id/cards/:cardId")
  async cardDetail(
    @Param("id") id: string,
    @Param("cardId") cardId: string,
    @CurrentMembership() membership: BoardMember,
    @Headers("accept-encoding") acceptEncoding: string | undefined,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    await this.sendRead(res, {
      request: {
        boardId: id,
        role: membership.role,
        projection: boardCardDetailProjection(cardId),
        route: BOARD_CARD_DETAIL_ROUTE,
        acceptEncoding,
        ifNoneMatch,
        precheck: () => this.readModel.assertCardInBoard(id, cardId),
      },
      deps: {
        stamp: (budget) => this.boards.getReadStamp(id, budget),
        build: async (budget) => {
          const body: BoardCardDetailDto = await this.readModel.detail(
            id,
            cardId,
            budget,
          );
          return {
            body,
            seq: body.seq,
            revision: BigInt(body.aggregateRevision),
          };
        },
      },
      projection: BOARD_READ_MODEL_VERSION,
    });
  }

  /**
   * Full board aggregate with the TASK-200.6 read path: conditional `304`,
   * single-flight, a bounded semaphore and negotiated gzip/Brotli.
   *
   * TASK-200.9 capability gate: a client that announces the read model
   * (`X-Janosik-Read-Model: v1`) is refused here unless it explicitly asks
   * for `?projection=full`. Old clients send no header and keep the exact
   * legacy behaviour; admin/export/internal callers ask explicitly.
   *
   * Ordering is deliberate: `MembershipGuard` has already answered 401/404/403
   * and resolved the role before any validator is compared, so a foreign
   * caller cannot get a 304 (or any board metadata) by presenting an ETag.
   * `X-Board-Seq` stays on both 200 and 304, so a client that revalidates can
   * still advance its SSE resume baseline.
   */

  @UseGuards(MembershipGuard)
  @Get(":id")
  async get(
    @Param("id") id: string,
    @CurrentMembership() membership: BoardMember,
    @Headers("accept-encoding") acceptEncoding: string | undefined,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Headers("x-janosik-read-model") readModelHeader: string | undefined,
    @Query("projection") projectionRaw: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const projection = stringQuery("projection", projectionRaw);
    if (
      readModelHeader !== undefined &&
      readModelHeader !== BOARD_READ_MODEL_VERSION &&
      readModelHeader !== "full"
    ) {
      throw new BadRequestException({
        message: "Unknown read-model capability",
        code: "invalid_read_model",
      });
    }
    if (readModelHeader === BOARD_READ_MODEL_VERSION && projection !== "full") {
      throw new BadRequestException({
        message:
          "This client uses the board read model; request ?projection=full explicitly for the legacy aggregate",
        code: "read_model_required",
      });
    }
    if (projection !== undefined && projection !== "full") {
      throw new BadRequestException("projection must be full");
    }
    const result = await this.boardRead.read(
      {
        boardId: id,
        role: membership.role,
        projection: BOARD_FULL_PROJECTION,
        route: BOARD_READ_ROUTE,
        acceptEncoding,
        ifNoneMatch,
      },
      {
        stamp: (budget) => this.boards.getReadStamp(id, budget),
        build: (budget) =>
          this.boards.getAggregateWithSeq(id, undefined, budget),
      },
    );
    // Board JSON is private and must not be stored by a browser or shared
    // cache. Clients still send If-None-Match explicitly; `no-store` only
    // stops an automatic cache from replaying another principal's body.
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Vary", "Accept-Encoding");
    res.setHeader("ETag", result.etag);
    res.setHeader("X-Board-Seq", String(result.seq));
    res.setHeader(BOARD_READ_MODEL_HEADER, "full");
    if (result.status === 304) {
      res.status(304).end();
      return;
    }
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    if (result.encoding !== "identity") {
      res.setHeader("Content-Encoding", result.encoding);
    }
    res.setHeader("Content-Length", String(result.body.byteLength));
    res.status(200).end(result.body);
  }

  /**
   * Shared response writer for the TASK-200.9 projections: same headers as
   * the full read, plus the capability marker. `304` keeps `X-Board-Seq` and
   * never builds the body.
   */
  private async sendRead(
    res: Response,
    input: {
      request: BoardReadRequest;
      deps: BoardReadDeps;
      projection: string;
    },
  ): Promise<void> {
    const result: BoardReadResponse = await this.boardRead.read(
      input.request,
      input.deps,
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Vary", "Accept-Encoding");
    res.setHeader("ETag", result.etag);
    res.setHeader("X-Board-Seq", String(result.seq));
    res.setHeader(BOARD_READ_MODEL_HEADER, input.projection);
    if (result.status === 304) {
      res.status(304).end();
      return;
    }
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    if (result.encoding !== "identity") {
      res.setHeader("Content-Encoding", result.encoding);
    }
    res.setHeader("Content-Length", String(result.body.byteLength));
    res.status(200).end(result.body);
  }

  @UseGuards(MembershipGuard)
  @Get(":id/search")
  search(
    @Param("id") id: string,
    @Query("q") q?: unknown,
    @Query("includeMatches") matches?: unknown,
  ): Promise<BoardCardSearchResult> {
    return this.boards.searchCards(id, searchQuery(q), includeMatches(matches));
  }

  /**
   * TASK-166.15 policy dashboard (ADR §6.3). Session-only board ADMIN, so an
   * agent token can neither read the control-plane state nor weaken it.
   */
  @UseGuards(MembershipGuard, SessionOnlyGuard)
  @BoardRoles(Role.ADMIN)
  @Get(":id/agent-policy")
  agentPolicy(@Param("id") id: string): Promise<BoardAgentPolicyStateDto> {
    return this.boards.getAgentPolicy(id);
  }

  @UseGuards(MembershipGuard, SessionOnlyGuard)
  @BoardRoles(Role.ADMIN)
  @Patch(":id/agent-policy")
  updateAgentPolicy(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateBoardAgentPolicyDto,
  ): Promise<BoardAgentPolicyStateDto> {
    return this.boards.updateAgentPolicy(id, user.id, {
      policy: dto.policy,
      version: dto.version,
    });
  }

  @UseGuards(MembershipGuard)
  @BoardRoles(Role.ADMIN)
  @TokenScope("admin")
  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @CurrentAgentSession() session: AgentSessionContext | undefined,
    @CurrentMembership() membership: BoardMember,
    @Headers("x-approval-id") approvalId: string | undefined,
  ): Promise<{ status: "ok" }> {
    const approval = await this.approvals.authorizeOperation({
      boardId: id,
      userId: user.id,
      role: membership.role,
      principal,
      agentSessionId: session?.id ?? null,
      op: "board.delete",
      target: { boardId: id },
      body: {},
      ...(approvalId !== undefined ? { approvalId } : {}),
    });
    await this.approvals.performOperation(approval, () =>
      this.boards.deleteBoard(
        id,
        user.id,
        requestAttribution(principal, session?.id),
        principal,
        approval !== null,
      ),
    );
    if (approval !== null) {
      await this.approvals.consumeOperation(approval, user.id, principal, {
        operation: "board.delete",
      });
    }
    return { status: "ok" };
  }

  @UseGuards(MembershipGuard)
  @Get(":id/members")
  members(
    @Param("id") id: string,
    @CurrentMembership() membership: BoardMember,
    @Query("includeExpired") includeExpired?: string,
  ): Promise<BoardMemberDto[]> {
    const wantsExpired = includeExpired === "1" || includeExpired === "true";
    // M15: lapsed rows are management data. The default directory stays the
    // active roster (pickers/filters assign only live members); the member
    // dialog explicitly asks for expired rows and is ADMIN-only.
    if (wantsExpired && membership.role !== Role.ADMIN) {
      throw new ForbiddenException(
        "Only board admins can list expired memberships",
      );
    }
    return this.boards.listMembers(id, wantsExpired);
  }

  /** Pending invitations (ADMIN only), so a wrong invite can be cancelled. */
  @UseGuards(MembershipGuard)
  @BoardRoles(Role.ADMIN)
  @TokenScope("admin")
  @Get(":id/invitations")
  pendingInvitations(@Param("id") id: string) {
    return this.boards.listPendingInvitations(id);
  }

  @UseGuards(MembershipGuard)
  @BoardRoles(Role.ADMIN)
  @TokenScope("admin")
  @Post(":id/members")
  async invite(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @CurrentAgentSession() session: AgentSessionContext | undefined,
    @CurrentMembership() membership: BoardMember,
    @Headers("x-approval-id") approvalId: string | undefined,
    @Body() dto: InviteMemberDto,
  ): Promise<BoardMemberDto> {
    const approval = await this.approvals.authorizeOperation({
      boardId: id,
      userId: user.id,
      role: membership.role,
      principal,
      agentSessionId: session?.id ?? null,
      op: "member.invite",
      target: { boardId: id },
      body: plainRecord(dto),
      ...(approvalId !== undefined ? { approvalId } : {}),
    });
    const result = await this.approvals.performOperation(approval, () =>
      this.boards.inviteMember(
        id,
        user.id,
        dto,
        requestAttribution(principal, session?.id),
        principal,
        approval !== null,
      ),
    );
    if (approval !== null) {
      await this.approvals.consumeOperation(approval, user.id, principal, {
        operation: "member.invite",
      });
    }
    return result;
  }

  @UseGuards(MembershipGuard)
  @BoardRoles(Role.ADMIN)
  @TokenScope("admin")
  @Patch(":id/members/:userId")
  async updateMember(
    @Param("id") id: string,
    @Param("userId") userId: string,
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @CurrentAgentSession() session: AgentSessionContext | undefined,
    @CurrentMembership() membership: BoardMember,
    @Headers("x-approval-id") approvalId: string | undefined,
    @Body() dto: UpdateMemberDto,
  ): Promise<BoardMemberDto> {
    const approval = await this.approvals.authorizeOperation({
      boardId: id,
      userId: user.id,
      role: membership.role,
      principal,
      agentSessionId: session?.id ?? null,
      op: "member.update",
      target: { boardId: id, userId },
      body: plainRecord(dto),
      ...(approvalId !== undefined ? { approvalId } : {}),
    });
    const result = await this.approvals.performOperation(approval, () =>
      this.boards.updateMember(
        id,
        user.id,
        userId,
        dto,
        requestAttribution(principal, session?.id),
        principal,
        approval !== null,
      ),
    );
    if (approval !== null) {
      await this.approvals.consumeOperation(approval, user.id, principal, {
        operation: "member.update",
      });
    }
    return result;
  }

  /**
   * TASK-177.2 (G-02): leave a board as yourself. Any accepted role may call
   * it, but the last ADMIN cannot — a board must never be left adminless.
   * Session-only: a PAT must not drop its owner's membership.
   *
   * No `MembershipGuard`: a repeated DELETE after a lost response must answer
   * success instead of 403. The service checks the board and treats an absent
   * membership as already-left. Declared before the `:userId` route so "me"
   * is not parsed as an id.
   */
  @UseGuards(JwtAuthGuard, SessionOnlyGuard)
  @Delete(":id/members/me")
  @HttpCode(HttpStatus.OK)
  async leaveBoard(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
  ): Promise<{ status: "ok" }> {
    await this.boards.leaveBoard(id, user.id, requestAttribution(principal));
    return { status: "ok" };
  }

  @UseGuards(MembershipGuard)
  @BoardRoles(Role.ADMIN)
  @TokenScope("admin")
  @Delete(":id/members/:userId")
  @HttpCode(HttpStatus.OK)
  async removeMember(
    @Param("id") id: string,
    @Param("userId") userId: string,
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @CurrentAgentSession() session: AgentSessionContext | undefined,
    @CurrentMembership() membership: BoardMember,
    @Headers("x-approval-id") approvalId: string | undefined,
  ): Promise<{ status: "ok" }> {
    const approval = await this.approvals.authorizeOperation({
      boardId: id,
      userId: user.id,
      role: membership.role,
      principal,
      agentSessionId: session?.id ?? null,
      op: "member.remove",
      target: { boardId: id, userId },
      body: {},
      ...(approvalId !== undefined ? { approvalId } : {}),
    });
    await this.approvals.performOperation(approval, () =>
      this.boards.removeMember(
        id,
        user.id,
        userId,
        requestAttribution(principal, session?.id),
        principal,
        approval !== null,
      ),
    );
    if (approval !== null) {
      await this.approvals.consumeOperation(approval, user.id, principal, {
        operation: "member.remove",
      });
    }
    return { status: "ok" };
  }

  /** TASK-177.7: soft-deleted content still inside the retention window. */
  @UseGuards(MembershipGuard)
  @BoardRoles(Role.ADMIN, Role.MEMBER)
  @Get(":id/deleted")
  deleted(@Param("id") id: string): Promise<DeletedBoardItemsDto> {
    return this.deletedItems.list(id);
  }

  /** TASK-177.7: user restore from "Recently deleted" (no true purge here). */
  @UseGuards(MembershipGuard)
  @BoardRoles(Role.ADMIN, Role.MEMBER)
  @Post(":id/deleted/:type/:itemId/restore")
  @HttpCode(HttpStatus.OK)
  restoreDeleted(
    @Param("id") id: string,
    @Param("type") type: string,
    @Param("itemId") itemId: string,
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @CurrentAgentSession() session: AgentSessionContext | undefined,
    @CurrentMembership() membership: BoardMember,
  ): Promise<{ status: "ok" }> {
    return this.deletedItems.restore(
      id,
      type,
      itemId,
      user,
      membership.role,
      requestAttribution(principal, session?.id),
      principal,
    );
  }

  @UseGuards(MembershipGuard)
  @Get(":id/export")
  async export(
    @Param("id") id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const serialized = await this.boards.exportBoardSerialized(id);
    // TASK-166.6: stream the exact validated string; do not parse it back
    // into an object only for Nest to serialize it a second time.
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return new StreamableFile(Buffer.from(serialized, "utf8"));
  }
}
