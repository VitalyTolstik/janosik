import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  ServiceUnavailableException,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { type BoardMember, Role } from "@prisma/client";
import type {
  BoardAgentPolicyStateDto,
  BoardAggregate,
  BoardCardSearchResult,
  BoardImportPreviewDto,
  BoardMemberDto,
  BoardSummary,
  DeletedBoardItemsDto,
  WorkspaceSearchResult,
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
   * Full board aggregate with the TASK-200.6 read path: conditional `304`,
   * single-flight, a bounded semaphore and negotiated gzip/Brotli.
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
    @Res() res: Response,
  ): Promise<void> {
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
