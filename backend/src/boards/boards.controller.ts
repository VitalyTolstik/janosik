import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
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
} from "@janosik/shared";
import type { AuthUser } from "@/auth/auth.types";
import type { AgentSessionContext, AuthPrincipal } from "@/auth/auth-principal";
import {
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
import { BoardsService } from "./boards.service";
import { UpdateBoardAgentPolicyDto } from "./dto/agent-policy.dto";
import { CreateBoardDto } from "./dto/create-board.dto";
import { InviteMemberDto } from "./dto/invite-member.dto";
import { UpdateMemberDto } from "./dto/update-member.dto";

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
    private readonly approvals: ApprovalsService,
    private readonly idempotency: IdempotencyService,
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
    const outcome = await this.idempotency.run({
      scope: "create_board",
      key: normalizeIdempotencyKey(rawKey),
      actorKey: idempotencyActorKey(user.id, principal),
      requestHash: hashIdempotentRequest({ title: dto.title }),
      run: async () => {
        const board = await this.boards.createBoard(user.id, dto, principal);
        return { body: board, status: 201, resourceId: board.id };
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

  @UseGuards(MembershipGuard)
  @Get(":id")
  async get(
    @Param("id") id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<BoardAggregate> {
    const { board, seq } = await this.boards.getAggregateWithSeq(id);
    // The client needs the seq this aggregate reflects to resume the SSE
    // stream exactly after it (TASK-30); the body stays the plain aggregate.
    res.setHeader("X-Board-Seq", String(seq));
    return board;
  }

  @UseGuards(MembershipGuard)
  @Get(":id/search")
  search(
    @Param("id") id: string,
    @Query("q") q?: string,
  ): Promise<BoardCardSearchResult> {
    return this.boards.searchCards(id, q ?? "");
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
  members(@Param("id") id: string): Promise<BoardMemberDto[]> {
    return this.boards.listMembers(id);
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
