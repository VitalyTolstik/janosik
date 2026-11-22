import {
  ConflictException,
  Injectable,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ApiTokenService } from "@/auth/api-token.service";
import { isWriteMethod } from "@/auth/agent-pause";
import type { AuthUser } from "@/auth/auth.types";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ARCHIVED_BOARD_MESSAGE } from "./archived-board";
import { GuardedRequest, MembershipGuard } from "./membership.guard";

/**
 * Board access for card-scoped and comment-scoped routes (TASK-28).
 *
 * Cards and comments do not carry a board id in the URL, so this guard
 * resolves the owning board first (`cardId` → card → column → board,
 * `commentId` → comment → card → …) and then runs the same membership,
 * expiry and `@BoardRoles()` checks as `MembershipGuard`. Unknown or
 * soft-deleted entities answer 404 without leaking board existence.
 */
@Injectable()
export class CardAccessGuard extends MembershipGuard {
  constructor(
    reflector: Reflector,
    prisma: PrismaService,
    apiTokens: ApiTokenService,
  ) {
    super(reflector, prisma, apiTokens);
  }

  /**
   * Card-scoped writes (comments, comment edits/deletes, attachment uploads
   * and deletes) bypass the command path. The board lock serializes them but
   * does not know about the archive; refuse them here, after membership and
   * role checks so the answer does not leak the board to an outsider. Reads
   * stay open: an archived card is still a readable view.
   */
  protected override async enforceMembership(
    context: ExecutionContext,
    request: GuardedRequest,
    user: AuthUser,
    boardId: string,
  ): Promise<boolean> {
    const allowed = await super.enforceMembership(
      context,
      request,
      user,
      boardId,
    );
    if (!allowed || !isWriteMethod(request.method)) return allowed;
    const board = await this.prisma.board.findFirst({
      where: { id: boardId, deletedAt: null },
      select: { archivedAt: true },
    });
    if (board?.archivedAt != null) {
      throw new ConflictException(ARCHIVED_BOARD_MESSAGE);
    }
    return true;
  }

  protected override async resolveBoardId(
    request: GuardedRequest,
  ): Promise<string | undefined> {
    const cardId = request.params?.cardId;
    if (cardId) {
      const card = await this.prisma.card.findFirst({
        where: { id: cardId, deletedAt: null },
        select: { column: { select: { boardId: true } } },
      });
      return card?.column.boardId;
    }

    const commentId = request.params?.commentId;
    if (commentId) {
      const comment = await this.prisma.comment.findFirst({
        where: { id: commentId, deletedAt: null },
        select: {
          card: {
            select: { deletedAt: true, column: { select: { boardId: true } } },
          },
        },
      });
      if (!comment || comment.card.deletedAt !== null) return undefined;
      return comment.card.column.boardId;
    }

    // Attachments (TASK-47) resolve through their card the same way. The row
    // may be soft-deleted: DELETE then answers an idempotent no-op, while the
    // content routes keep their own live-row 404.
    const attachmentId = request.params?.attachmentId;
    if (attachmentId) {
      const attachment = await this.prisma.attachment.findFirst({
        where: { id: attachmentId },
        select: {
          card: {
            select: { deletedAt: true, column: { select: { boardId: true } } },
          },
        },
      });
      if (!attachment || attachment.card.deletedAt !== null) return undefined;
      return attachment.card.column.boardId;
    }

    return undefined;
  }
}
