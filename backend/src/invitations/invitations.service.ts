import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { BoardInvitationDto } from "@janosik/shared";
import { PrismaService } from "@/common/prisma/prisma.service";

/**
 * Opt-in invitations (TASK-35 addendum).
 *
 * A board invitation is a `BoardMember` row with `acceptedAt: null`: it is
 * invisible to every board route (the guard rejects it like a non-member)
 * and only shows up in the invitee's `GET /invitations` feed. Accepting
 * stamps `acceptedAt` — from then on the row is ordinary membership;
 * declining deletes the row. Both write an `Activity` event so the board
 * feed keeps the story complete.
 */
@Injectable()
export class InvitationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Pending, non-expired-board invitations of the caller, newest first. */
  async listForUser(userId: string): Promise<BoardInvitationDto[]> {
    const invitations = await this.prisma.boardMember.findMany({
      where: { userId, acceptedAt: null, board: { deletedAt: null } },
      include: {
        board: { select: { title: true } },
        invitedBy: { select: { displayName: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return invitations.map((invitation) => ({
      id: invitation.id,
      boardId: invitation.boardId,
      boardTitle: invitation.board.title,
      role: invitation.role,
      expiresAt: invitation.expiresAt?.getTime() ?? null,
      createdAt: invitation.createdAt.getTime(),
      invitedByName: invitation.invitedBy?.displayName ?? null,
      invitedByEmail: invitation.invitedBy?.email ?? null,
    }));
  }

  /** Accept a pending invitation — the board appears in `GET /boards`. */
  async accept(userId: string, invitationId: string): Promise<void> {
    const invitation = await this.findPending(userId, invitationId);
    if (
      invitation.expiresAt !== null &&
      invitation.expiresAt.getTime() <= Date.now()
    ) {
      // A time-limited VIEWER invite past its deadline cannot be accepted;
      // drop it so the bell stops offering a dead action.
      await this.prisma.boardMember.delete({ where: { id: invitation.id } });
      throw new ConflictException("Invitation has expired");
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.boardMember.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });
      await tx.activity.create({
        data: {
          boardId: invitation.boardId,
          type: "member_invite_accepted",
          actorId: userId,
          details: { userId, role: invitation.role },
        },
      });
    });
  }

  /** Decline a pending invitation — the row is dropped, access never granted. */
  async decline(userId: string, invitationId: string): Promise<void> {
    const invitation = await this.findPending(userId, invitationId);
    await this.prisma.$transaction(async (tx) => {
      await tx.boardMember.delete({ where: { id: invitation.id } });
      await tx.activity.create({
        data: {
          boardId: invitation.boardId,
          type: "member_invite_declined",
          actorId: userId,
          details: { userId, role: invitation.role },
        },
      });
    });
  }

  private async findPending(userId: string, invitationId: string) {
    const invitation = await this.prisma.boardMember.findFirst({
      where: {
        id: invitationId,
        userId,
        acceptedAt: null,
        board: { deletedAt: null },
      },
    });
    if (!invitation) {
      // Someone else's or unknown invitation — 404 either way, no probing.
      throw new NotFoundException("Invitation not found");
    }
    return invitation;
  }
}
