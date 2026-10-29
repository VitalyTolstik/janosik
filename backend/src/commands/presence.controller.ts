import {
  Body,
  Controller,
  GoneException,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { MembershipGuard } from "@/common/membership.guard";
import { CurrentUser } from "@/auth/current-user.decorator";
import type { AuthUser } from "@/auth/auth.types";
import { PresenceService } from "@/realtime/presence.service";
import { PresencePingDto } from "./dto/presence-ping.dto";

/**
 * `POST /boards/:id/presence` — presence heartbeat (TASK-36).
 *
 * The SSE stream has no back channel, so the tab proves liveness with a
 * small authenticated ping every 25 s; a session that stops pinging is
 * swept after 60 s. A ping never conjures a session — it only refreshes one
 * the stream opened. A ping for a session that is gone answers `410`: the
 * client reopens the stream and rejoins instead of silently disappearing
 * (TASK-145) — a backgrounded tab throttled past the TTL would otherwise
 * stay invisible until a manual reload.
 */
@Controller("boards/:id/presence")
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  @UseGuards(MembershipGuard)
  @Post()
  @HttpCode(204)
  ping(
    @Param("id") id: string,
    @Body() dto: PresencePingDto,
    @CurrentUser() user: AuthUser,
  ): void {
    // A ping only refreshes a session this user actually owns (TASK-102).
    if (!this.presence.touch(id, dto.clientId, user.id)) {
      throw new GoneException("presence session expired");
    }
  }
}
