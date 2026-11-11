import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { type BoardMember, Role } from "@prisma/client";
import type { BoardShareDto } from "@janosik/shared";
import type { AuthUser } from "@/auth/auth.types";
import type { AgentSessionContext, AuthPrincipal } from "@/auth/auth-principal";
import { CurrentAgentSession, CurrentPrincipal } from "@/auth/auth-principal";
import { requestAttribution } from "@/auth/request-attribution";
import { TokenScope } from "@/auth/token-scope.decorator";
import { CurrentUser } from "@/auth/current-user.decorator";
import { ApprovalsService } from "@/approvals/approvals.service";
import { plainRecord } from "@/approvals/approval-plan";
import { BoardRoles } from "@/common/board-roles.decorator";
import { CurrentMembership } from "@/common/current-membership.decorator";
import {
  hashIdempotentRequest,
  idempotencyActorKey,
  IdempotencyService,
  normalizeIdempotencyKey,
} from "@/common/idempotency.service";
import { MembershipGuard } from "@/common/membership.guard";
import { rollbackOnThrow } from "@/common/rollback-certainty";
import { CreateShareDto, UpdateShareDto } from "./dto/share.dto";
import { ShareService } from "./share.service";

/**
 * Owner-side share management (TASK-58, §7.9.4): a board ADMIN creates,
 * lists, refreshes, edits and revokes its own links. Nested under the board
 * so `MembershipGuard` resolves the board from `:id` and `@BoardRoles(ADMIN)`
 * gates every route — a mere member or viewer never manages shares.
 */
@Controller("boards/:id/shares")
@UseGuards(MembershipGuard)
@BoardRoles(Role.ADMIN)
@TokenScope("admin")
export class BoardSharesController {
  constructor(
    private readonly shares: ShareService,
    private readonly approvals: ApprovalsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  list(@Param("id") id: string): Promise<BoardShareDto[]> {
    return this.shares.listByBoard(id);
  }

  @Post()
  async create(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @CurrentAgentSession() session: AgentSessionContext | undefined,
    @CurrentMembership() membership: BoardMember,
    @Headers("x-approval-id") approvalId: string | undefined,
    @Body() dto: CreateShareDto,
    @Headers("idempotency-key") rawKey?: string,
  ): Promise<BoardShareDto> {
    const create = async (): Promise<BoardShareDto> => {
      const approval = await rollbackOnThrow(() =>
        this.approvals.authorizeOperation({
          boardId: id,
          userId: user.id,
          role: membership.role,
          principal,
          agentSessionId: session?.id ?? null,
          op: "share.create",
          target: { boardId: id },
          body: plainRecord(dto),
          ...(approvalId !== undefined ? { approvalId } : {}),
        }),
      );
      const result = await this.approvals.performOperation(approval, () =>
        this.shares.create(
          id,
          user.id,
          dto,
          "user",
          requestAttribution(principal, session?.id),
          principal,
          approval !== null,
        ),
      );
      if (approval !== null) {
        await this.approvals.consumeOperation(approval, user.id, principal, {
          operation: "share.create",
          shareId: result.id,
        });
      }
      return result;
    };
    const key = normalizeIdempotencyKey(rawKey);
    if (key === undefined) return create();
    const outcome = await this.idempotency.run({
      scope: "create_share",
      key,
      actorKey: idempotencyActorKey(user.id, principal),
      requestHash: hashIdempotentRequest({
        boardId: id,
        mode: dto.mode,
        title: dto.title,
        includeComments: dto.includeComments,
        includeAttachments: dto.includeAttachments,
        expiresAt:
          dto.expiresInHours === undefined ? (dto.expiresAt ?? null) : null,
        expiresInHours: dto.expiresInHours ?? null,
      }),
      run: async () => {
        const share = await create();
        return { body: share, status: 201, resourceId: share.id };
      },
    });
    return outcome.body;
  }

  @Post(":shareId/refresh")
  refresh(
    @Param("id") id: string,
    @Param("shareId") shareId: string,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @CurrentAgentSession() session: AgentSessionContext | undefined,
  ): Promise<BoardShareDto> {
    return this.shares
      .requireShareOnBoard(shareId, id)
      .then(() =>
        this.shares.refreshSnapshot(
          shareId,
          principal,
          requestAttribution(principal, session?.id),
        ),
      );
  }

  @Patch(":shareId")
  async update(
    @Param("id") id: string,
    @Param("shareId") shareId: string,
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @CurrentAgentSession() session: AgentSessionContext | undefined,
    @CurrentMembership() membership: BoardMember,
    @Headers("x-approval-id") approvalId: string | undefined,
    @Body() dto: UpdateShareDto,
  ): Promise<BoardShareDto> {
    await this.shares.requireShareOnBoard(shareId, id);
    const approval = await this.approvals.authorizeOperation({
      boardId: id,
      userId: user.id,
      role: membership.role,
      principal,
      agentSessionId: session?.id ?? null,
      op: "share.update",
      target: { boardId: id, shareId },
      body: plainRecord(dto),
      ...(approvalId !== undefined ? { approvalId } : {}),
    });
    const result = await this.approvals.performOperation(approval, () =>
      this.shares.update(
        shareId,
        dto,
        principal,
        requestAttribution(principal, session?.id),
        approval !== null,
      ),
    );
    if (approval !== null) {
      await this.approvals.consumeOperation(approval, user.id, principal, {
        operation: "share.update",
        shareId,
      });
    }
    return result;
  }

  @Delete(":shareId")
  async revoke(
    @Param("id") id: string,
    @Param("shareId") shareId: string,
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @CurrentAgentSession() session: AgentSessionContext | undefined,
    @CurrentMembership() membership: BoardMember,
    @Headers("x-approval-id") approvalId: string | undefined,
  ): Promise<BoardShareDto> {
    await this.shares.requireShareOnBoard(shareId, id);
    const approval = await this.approvals.authorizeOperation({
      boardId: id,
      userId: user.id,
      role: membership.role,
      principal,
      agentSessionId: session?.id ?? null,
      op: "share.revoke",
      target: { boardId: id, shareId },
      body: {},
      ...(approvalId !== undefined ? { approvalId } : {}),
    });
    const result = await this.approvals.performOperation(approval, () =>
      this.shares.revoke(
        shareId,
        user.id,
        requestAttribution(principal, session?.id),
        principal,
        approval !== null,
      ),
    );
    if (approval !== null) {
      await this.approvals.consumeOperation(approval, user.id, principal, {
        operation: "share.revoke",
        shareId,
      });
    }
    return result;
  }

  @Delete(":shareId/permanent")
  @HttpCode(204)
  async deleteRevoked(
    @Param("id") id: string,
    @Param("shareId") shareId: string,
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @CurrentAgentSession() session: AgentSessionContext | undefined,
    @CurrentMembership() membership: BoardMember,
    @Headers("x-approval-id") approvalId: string | undefined,
  ): Promise<void> {
    await this.shares.requireShareOnBoard(shareId, id);
    const approval = await this.approvals.authorizeOperation({
      boardId: id,
      userId: user.id,
      role: membership.role,
      principal,
      agentSessionId: session?.id ?? null,
      op: "share.delete",
      target: { boardId: id, shareId },
      body: {},
      ...(approvalId !== undefined ? { approvalId } : {}),
    });
    await this.approvals.performOperation(approval, () =>
      this.shares.deleteRevoked(
        id,
        shareId,
        user.id,
        requestAttribution(principal, session?.id),
        principal,
        approval !== null,
      ),
    );
    if (approval !== null) {
      await this.approvals.consumeOperation(approval, user.id, principal, {
        operation: "share.delete",
        shareId,
      });
    }
  }
}
