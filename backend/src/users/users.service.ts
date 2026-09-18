import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthUser } from "@/auth/auth.types";
import { toAuthUser } from "@/auth/auth-user.mapper";
import { PrismaService } from "@/common/prisma/prisma.service";
import { PresenceService } from "@/realtime/presence.service";
import { RealtimeService } from "@/realtime/realtime.service";
import type { UpdateProfileDto } from "./dto/update-profile.dto";

/** Account self-service (TASK-36.1): profile. */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Apply only the provided keys and return the fresh public projection. */
  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<AuthUser> {
    const data: Prisma.UserUpdateInput = {};
    if (dto.displayName !== undefined) {
      data.displayName = dto.displayName;
    }
    if (dto.avatarColor !== undefined) {
      data.avatarColor = dto.avatarColor;
    }
    const user = await this.prisma.user.update({ where: { id: userId }, data });
    const fresh = toAuthUser(user);
    await this.announceProfile(userId, dto, fresh);
    return fresh;
  }

  /**
   * Tell live clients about a rename or a new avatar color (TASK-36.1).
   *
   * SSE rosters are captured at join, so every open session of this user is
   * rewritten in place — a tab keeps its connection and simply sees the new
   * face. Each board the account belongs to then gets a `membership` frame
   * with `change: "updated"`, which is what makes open member lists, card
   * faces and the table view re-read the directory. An empty patch stays
   * silent, mirroring the no-op PATCH of the member directory.
   */
  private async announceProfile(
    userId: string,
    dto: UpdateProfileDto,
    user: AuthUser,
  ): Promise<void> {
    if (dto.displayName === undefined && dto.avatarColor === undefined) return;
    this.presence.updateUser(userId, {
      displayName: user.displayName,
      avatarColor: user.avatarColor,
    });
    const boards = await this.prisma.boardMember.findMany({
      where: { userId, acceptedAt: { not: null } },
      select: { boardId: true },
    });
    for (const { boardId } of boards) {
      this.realtime.publish(boardId, {
        type: "membership",
        boardId,
        userId,
        change: "updated",
      });
    }
  }
}
