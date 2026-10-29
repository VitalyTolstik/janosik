import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { writeFile } from "node:fs/promises";

import type { AuthUser } from "@/auth/auth.types";
import { toAuthUser } from "@/auth/auth-user.mapper";
import { PrismaService } from "@/common/prisma/prisma.service";
import { PresenceService } from "@/realtime/presence.service";
import { RealtimeService } from "@/realtime/realtime.service";
import {
  AVATAR_MIME_ALLOWLIST,
  extensionForMime,
  sniffMime,
  StorageService,
} from "@/attachments/storage.service";
import type { UploadedBlob } from "@/attachments/attachments.service";
import { LIMITS } from "@janosik/shared";
import type { UpdateProfileDto } from "./dto/update-profile.dto";

/** Account self-service (TASK-36.1): profile. */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    private readonly realtime: RealtimeService,
    private readonly storage: StorageService,
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
    if (dto.notifyDigest !== undefined) {
      data.notifyDigest = dto.notifyDigest;
    }
    const user = await this.prisma.user.update({ where: { id: userId }, data });
    const fresh = toAuthUser(user);
    await this.announceProfile(userId, dto, fresh);
    return fresh;
  }

  /**
   * Profile avatar (TASK-47): store the image on the local disk, remember
   * its server-generated name on the user, drop the replaced blob. The
   * announce mirrors `updateProfile` so every open roster picks the new
   * face without a reconnect.
   */
  async uploadAvatar(userId: string, file?: UploadedBlob): Promise<AuthUser> {
    if (!file || file.size <= 0) {
      throw new BadRequestException({
        message: "File is required",
        field: "file",
      });
    }
    if (file.size > LIMITS.avatarSize) {
      throw new BadRequestException({
        message: `Avatar must be at most ${LIMITS.avatarSize} bytes`,
        field: "file",
      });
    }
    // TASK-76: trust the bytes, not the multipart header. A real PNG/JPEG/
    // GIF/WebP passes; HTML or text dressed as an image does not.
    const sniffed = sniffMime(file.buffer);
    if (sniffed === null || !AVATAR_MIME_ALLOWLIST.test(sniffed)) {
      throw new BadRequestException({
        message: "Avatar must be a PNG, JPEG, GIF or WebP image",
        field: "file",
      });
    }

    const previous = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarPath: true },
    });
    if (!previous) throw new NotFoundException();

    await this.storage.ensureDirs();
    // Name the blob after the *detected* type so the served Content-Type
    // (derived from the extension) matches the real bytes.
    const ext = extensionForMime(sniffed) ?? ".png";
    const storedName = this.storage.storedName(`avatar${ext}`);
    await writeFile(this.storage.avatarPath(storedName), file.buffer);

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarPath: storedName },
    });
    if (previous.avatarPath) {
      await this.storage.remove(this.storage.avatarPath(previous.avatarPath));
    }

    const fresh = toAuthUser(user);
    this.presence.updateUser(userId, {
      displayName: fresh.displayName,
      avatarColor: fresh.avatarColor,
      avatarPath: fresh.avatarPath,
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
    return fresh;
  }

  /** Resolve the stored avatar blob for streaming (404 when absent). */
  async avatarFile(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarPath: true },
    });
    if (!user?.avatarPath) throw new NotFoundException();
    return user.avatarPath;
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
      avatarPath: user.avatarPath,
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
