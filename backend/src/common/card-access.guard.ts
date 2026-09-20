import { Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ApiTokenService } from "@/auth/api-token.service";
import { PrismaService } from "@/common/prisma/prisma.service";
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

    // Attachments (TASK-47) resolve through their card the same way.
    const attachmentId = request.params?.attachmentId;
    if (attachmentId) {
      const attachment = await this.prisma.attachment.findFirst({
        where: { id: attachmentId, deletedAt: null },
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
