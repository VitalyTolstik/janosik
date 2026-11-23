import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { Role } from "@prisma/client";
import type { BoardMember } from "@prisma/client";
import type {
  CardClaimIntentResponse,
  CardContextDto,
  CardIntentResponse,
  CardMoveIntentResponse,
} from "@janosik/shared";
import type { AuthUser } from "@/auth/auth.types";
import type { AgentSessionContext, AuthPrincipal } from "@/auth/auth-principal";
import {
  actorTypeOf,
  CurrentAgentSession,
  CurrentPrincipal,
} from "@/auth/auth-principal";
import { requestAttribution } from "@/auth/request-attribution";
import { CurrentUser } from "@/auth/current-user.decorator";
import { BoardRoles } from "@/common/board-roles.decorator";
import { CurrentMembership } from "@/common/current-membership.decorator";
import { MembershipGuard } from "@/common/membership.guard";
import { CardIntentsService } from "./card-intents.service";
import {
  ClaimCardIntentDto,
  MoveCardIntentDto,
  PatchCardIntentDto,
} from "./dto/card-intent.dto";

/**
 * TASK-200.7 targeted card intents. The route names the board and card, so
 * the server can load the card/column/workflow slice instead of the whole
 * board. The response is a normal `CommandResponse` (seq + fresh versions)
 * plus the card context the agent needs to continue.
 */
@Controller("boards/:id/cards/:cardId")
export class CardIntentsController {
  constructor(private readonly intents: CardIntentsService) {}

  @UseGuards(MembershipGuard)
  @Get("context")
  context(
    @Param("id") boardId: string,
    @Param("cardId") cardId: string,
  ): Promise<CardContextDto> {
    return this.intents.context(boardId, cardId);
  }

  @UseGuards(MembershipGuard)
  @BoardRoles(Role.ADMIN, Role.MEMBER)
  @Post("claim")
  @HttpCode(HttpStatus.OK)
  async claim(
    @Param("id") boardId: string,
    @Param("cardId") cardId: string,
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @CurrentAgentSession() session: AgentSessionContext | undefined,
    @CurrentMembership() membership: BoardMember,
    @Headers("x-approval-id") approvalId: string | undefined,
    @Body() dto: ClaimCardIntentDto,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<CardClaimIntentResponse> {
    const response = await this.intents.claim(boardId, cardId, dto, {
      actorId: user.id,
      actorType: actorTypeOf(principal),
      actorRole: membership.role,
      attribution: requestAttribution(principal, session?.id),
      ...(principal !== undefined ? { principal } : {}),
      ...(approvalId !== undefined ? { approvalId } : {}),
    });
    setRunHeader(res, response.runId);
    return response;
  }

  @UseGuards(MembershipGuard)
  @BoardRoles(Role.ADMIN, Role.MEMBER)
  @Post("move")
  @HttpCode(HttpStatus.OK)
  async move(
    @Param("id") boardId: string,
    @Param("cardId") cardId: string,
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @CurrentAgentSession() session: AgentSessionContext | undefined,
    @CurrentMembership() membership: BoardMember,
    @Headers("x-approval-id") approvalId: string | undefined,
    @Body() dto: MoveCardIntentDto,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<CardMoveIntentResponse> {
    const response = await this.intents.move(boardId, cardId, dto, {
      actorId: user.id,
      actorType: actorTypeOf(principal),
      actorRole: membership.role,
      attribution: requestAttribution(principal, session?.id),
      ...(principal !== undefined ? { principal } : {}),
      ...(approvalId !== undefined ? { approvalId } : {}),
    });
    setRunHeader(res, response.runId);
    return response;
  }

  @UseGuards(MembershipGuard)
  @BoardRoles(Role.ADMIN, Role.MEMBER)
  @Patch()
  async patch(
    @Param("id") boardId: string,
    @Param("cardId") cardId: string,
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @CurrentAgentSession() session: AgentSessionContext | undefined,
    @CurrentMembership() membership: BoardMember,
    @Headers("x-approval-id") approvalId: string | undefined,
    @Body() dto: PatchCardIntentDto,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<CardIntentResponse> {
    const response = await this.intents.patch(boardId, cardId, dto, {
      actorId: user.id,
      actorType: actorTypeOf(principal),
      actorRole: membership.role,
      attribution: requestAttribution(principal, session?.id),
      ...(principal !== undefined ? { principal } : {}),
      ...(approvalId !== undefined ? { approvalId } : {}),
    });
    setRunHeader(res, response.runId);
    return response;
  }
}

function setRunHeader(
  res: Response | undefined,
  runId: string | null | undefined,
): void {
  if (runId !== undefined && runId !== null) res?.setHeader("X-Run-Id", runId);
}
