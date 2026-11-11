import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Role } from "@prisma/client";
import type { CommentDto, CommentPage } from "@janosik/shared";
import type { AuthUser } from "@/auth/auth.types";
import type { AgentSessionContext, AuthPrincipal } from "@/auth/auth-principal";
import { CurrentAgentSession, CurrentPrincipal } from "@/auth/auth-principal";
import { requestAttribution } from "@/auth/request-attribution";
import { CurrentUser } from "@/auth/current-user.decorator";
import { BoardRoles } from "@/common/board-roles.decorator";
import { CardAccessGuard } from "@/common/card-access.guard";
import { CurrentMembership } from "@/common/current-membership.decorator";
import type { BoardMember } from "@prisma/client";
import {
  hashIdempotentRequest,
  idempotencyActorKey,
  IdempotencyService,
  normalizeIdempotencyKey,
} from "@/common/idempotency.service";
import { CommentsService } from "./comments.service";
import { CreateCommentDto } from "./dto/create-comment.dto";

/**
 * Card comments (§7.4, TASK-28): write/read/delete. `CardAccessGuard`
 * resolves the card's board and enforces membership; writing is
 * ADMIN/MEMBER (VIEWER reads), deletion is the author's own comment.
 */
@Controller()
export class CommentsController {
  constructor(
    private readonly comments: CommentsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @UseGuards(CardAccessGuard)
  @Get(["cards/:cardId/board-context", "comments/:commentId/board-context"])
  boardContext(@CurrentMembership() membership: BoardMember): {
    boardId: string;
  } {
    return { boardId: membership.boardId };
  }

  @UseGuards(CardAccessGuard)
  @BoardRoles(Role.ADMIN, Role.MEMBER)
  @Post("cards/:cardId/comments")
  async create(
    @Param("cardId") cardId: string,
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @CurrentAgentSession() session: AgentSessionContext | undefined,
    @Body() dto: CreateCommentDto,
    @Headers("idempotency-key") rawKey?: string,
  ): Promise<CommentDto> {
    const outcome = await this.idempotency.run({
      scope: "add_comment",
      key: normalizeIdempotencyKey(rawKey),
      actorKey: idempotencyActorKey(user.id, principal),
      // `commandId` is the comment-transport idempotency key; the REST-level
      // key identifies the same intent even if a retry mints a new commandId.
      requestHash: hashIdempotentRequest({
        cardId,
        text: dto.text,
        kind: dto.kind,
      }),
      run: async () => {
        const comment = await this.comments.create(
          cardId,
          user.id,
          dto,
          requestAttribution(principal, session?.id),
          principal,
        );
        return { body: comment, status: 201, resourceId: comment.id };
      },
    });
    return outcome.body;
  }

  @UseGuards(CardAccessGuard)
  @Get("cards/:cardId/comments")
  list(
    @Param("cardId") cardId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
    @Query("kind") kind?: string,
  ): Promise<CommentPage> {
    return this.comments.list(cardId, cursor, limit, kind);
  }

  @UseGuards(CardAccessGuard)
  @BoardRoles(Role.ADMIN, Role.MEMBER)
  @Delete("comments/:commentId")
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param("commentId") commentId: string,
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @CurrentAgentSession() session: AgentSessionContext | undefined,
  ): Promise<{ status: "ok" }> {
    await this.comments.remove(
      commentId,
      user.id,
      requestAttribution(principal, session?.id),
      principal,
    );
    return { status: "ok" };
  }
}
