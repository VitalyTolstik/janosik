import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { MembershipGuard } from "@/common/membership.guard";
import { PresenceService } from "@/realtime/presence.service";
import { PresencePingDto } from "./dto/presence-ping.dto";

/**
 * `POST /boards/:id/presence` — presence heartbeat (TASK-36).
 *
 * The SSE stream has no back channel, so the tab proves liveness with a
 * small authenticated ping every 25 s; a session that stops pinging is
 * swept after 60 s. Unknown ids are accepted and ignored: the server never
 * conjures a session out of a ping, only refreshes one the stream opened.
 */
@Controller("boards/:id/presence")
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  @UseGuards(MembershipGuard)
  @Post()
  @HttpCode(204)
  ping(@Param("id") id: string, @Body() dto: PresencePingDto): void {
    this.presence.touch(id, dto.clientId);
  }
}
