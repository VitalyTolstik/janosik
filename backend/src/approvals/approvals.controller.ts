import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import type { BoardMember } from "@prisma/client";
import { Role } from "@prisma/client";
import type { ApprovalRequestDto } from "@janosik/shared";
import type { AuthPrincipal } from "@/auth/auth-principal";
import { CurrentPrincipal, SessionOnlyGuard } from "@/auth/auth-principal";
import { CurrentUser } from "@/auth/current-user.decorator";
import { TokenScope } from "@/auth/token-scope.decorator";
import type { AuthUser } from "@/auth/auth.types";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import { BoardRoles } from "@/common/board-roles.decorator";
import { CurrentMembership } from "@/common/current-membership.decorator";
import { MembershipGuard } from "@/common/membership.guard";
import { ApprovalsService } from "./approvals.service";
import {
  ApprovalDecisionDto,
  ApprovalListQueryDto,
  CreateApprovalDto,
} from "./dto/approval.dto";

/**
 * Approval queue (TASK-166.5, ADR §10). Creation is PAT-only; a decision is
 * session-only board ADMIN; cancel is the requesting token or a board ADMIN;
 * reads are a board ADMIN or the requesting token.
 */
@Controller("boards/:id/approvals")
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @UseGuards(MembershipGuard)
  @BoardRoles(Role.ADMIN, Role.MEMBER)
  @TokenScope("worker")
  @Post()
  create(
    @Param("id") boardId: string,
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @CurrentMembership() membership: BoardMember,
    @Body() dto: CreateApprovalDto,
  ): Promise<ApprovalRequestDto> {
    return this.approvals.create(
      boardId,
      user.id,
      membership.role,
      principal,
      dto,
    );
  }

  @UseGuards(MembershipGuard)
  @Get()
  list(
    @Param("id") boardId: string,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @CurrentMembership() membership: BoardMember,
    @Query() query: ApprovalListQueryDto,
  ): Promise<ApprovalRequestDto[]> {
    return this.approvals.list(boardId, membership.role, principal, query);
  }

  @UseGuards(MembershipGuard)
  @Get(":approvalId")
  get(
    @Param("id") boardId: string,
    @Param("approvalId") approvalId: string,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @CurrentMembership() membership: BoardMember,
  ): Promise<ApprovalRequestDto> {
    return this.approvals.get(boardId, approvalId, membership.role, principal);
  }

  // Authenticate first so `pat_forbidden` is the answer to a PAT (even a
  // high-preset one); `MembershipGuard` then resolves the board and role.
  @UseGuards(JwtAuthGuard, SessionOnlyGuard, MembershipGuard)
  @BoardRoles(Role.ADMIN)
  @TokenScope("admin")
  @Post(":approvalId/decision")
  @HttpCode(HttpStatus.OK)
  decide(
    @Param("id") boardId: string,
    @Param("approvalId") approvalId: string,
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @CurrentMembership() membership: BoardMember,
    @Body() dto: ApprovalDecisionDto,
  ): Promise<ApprovalRequestDto> {
    return this.approvals.decide(
      boardId,
      approvalId,
      user.id,
      membership.role,
      principal,
      dto,
    );
  }

  @UseGuards(MembershipGuard)
  @Post(":approvalId/cancel")
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param("id") boardId: string,
    @Param("approvalId") approvalId: string,
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @CurrentMembership() membership: BoardMember,
  ): Promise<ApprovalRequestDto> {
    return this.approvals.cancel(
      boardId,
      approvalId,
      user.id,
      membership.role,
      principal,
    );
  }
}
