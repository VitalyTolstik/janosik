import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import type {
  AttentionNotificationDto,
  AttentionNotificationPage,
  NotificationSettingsDto,
} from "@janosik/shared";
import type { AuthUser } from "@/auth/auth.types";
import { CurrentUser } from "@/auth/current-user.decorator";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import { SessionOnlyGuard } from "@/auth/auth-principal";
import { AttentionService } from "./attention.service";
import { UpdateNotificationSettingsDto } from "./dto/notification-settings.dto";

/**
 * TASK-166.9 in-app attention surface. Session-only: an API key must never
 * read the human inbox, even when it belongs to the same account. The UI
 * behind these routes is TASK-166.13/166.14; this is the smallest backend
 * contract it needs.
 */
@Controller("users/me")
@UseGuards(JwtAuthGuard, SessionOnlyGuard)
export class NotificationsController {
  constructor(private readonly attention: AttentionService) {}

  @Get("notifications")
  list(
    @CurrentUser() user: AuthUser,
    @Query("boardId") boardId?: string,
    @Query("unreadOnly") unreadOnly?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ): Promise<AttentionNotificationPage> {
    return this.attention.list(user.id, {
      ...(boardId !== undefined && boardId !== "" ? { boardId } : {}),
      ...(unreadOnly !== undefined
        ? { unreadOnly: parseBool(unreadOnly) }
        : {}),
      ...(cursor !== undefined && cursor !== "" ? { cursor } : {}),
      ...(limit !== undefined && limit !== ""
        ? { limit: parseLimit(limit) }
        : {}),
    });
  }

  @Post("notifications/read-all")
  @HttpCode(HttpStatus.OK)
  readAll(
    @CurrentUser() user: AuthUser,
    @Body() body: { boardId?: string },
  ): Promise<{ updated: number }> {
    return this.attention.markAllRead(
      user.id,
      typeof body?.boardId === "string" ? body.boardId : undefined,
    );
  }

  @Post("notifications/:id/read")
  @HttpCode(HttpStatus.OK)
  read(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
  ): Promise<AttentionNotificationDto> {
    return this.attention.markRead(user.id, id);
  }

  @Get("notification-settings")
  settings(@CurrentUser() user: AuthUser): Promise<NotificationSettingsDto> {
    return this.attention.settings(user.id);
  }

  @Patch("notification-settings")
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateNotificationSettingsDto,
  ): Promise<NotificationSettingsDto> {
    return this.attention.updateSettings(user.id, dto);
  }
}

function parseBool(raw: string): boolean {
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  if (raw === "0" || raw === "false" || raw === "no") return false;
  throw new BadRequestException("unreadOnly must be a boolean");
}

function parseLimit(raw: string): number {
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new BadRequestException("limit must be a positive integer");
  }
  return limit;
}
