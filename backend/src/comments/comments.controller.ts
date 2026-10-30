import {
  Body,
  Controller,
  Delete,
  Get,
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
import type { AuthPrincipal } from "@/auth/auth-principal";
import { actorTypeOf, CurrentPrincipal } from "@/auth/auth-principal";
import { CurrentUser } from "@/auth/current-user.decorator";
import { BoardRoles } from "@/common/board-roles.decorator";
import { CardAccessGuard } from "@/common/card-access.guard";
import { CommentsService } from "./comments.service";
import { CreateCommentDto } from "./dto/create-comment.dto";

/**
 * Card comments (§7.4, TASK-28): write/read/delete. `CardAccessGuard`
 * resolves the card's board and enforces membership; writing is
 * ADMIN/MEMBER (VIEWER reads), deletion is the author's own comment.
 */
@Controller()
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @UseGuards(CardAccessGuard)
  @BoardRoles(Role.ADMIN, Role.MEMBER)
  @Post("cards/:cardId/comments")
  create(
    @Param("cardId") cardId: string,
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @Body() dto: CreateCommentDto,
  ): Promise<CommentDto> {
    return this.comments.create(cardId, user.id, dto, actorTypeOf(principal));
  }

  @UseGuards(CardAccessGuard)
  @Get("cards/:cardId/comments")
  list(
    @Param("cardId") cardId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ): Promise<CommentPage> {
    return this.comments.list(cardId, cursor, limit);
  }

  @UseGuards(CardAccessGuard)
  @BoardRoles(Role.ADMIN, Role.MEMBER)
  @Delete("comments/:commentId")
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param("commentId") commentId: string,
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
  ): Promise<{ status: "ok" }> {
    await this.comments.remove(commentId, user.id, actorTypeOf(principal));
    return { status: "ok" };
  }
}
