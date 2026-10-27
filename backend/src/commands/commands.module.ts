import { Module } from "@nestjs/common";
import { AuthModule } from "@/auth/auth.module";
import { MembershipGuard } from "@/common/membership.guard";
import { RealtimeModule } from "@/realtime/realtime.module";
import { CommandsController } from "./commands.controller";
import { CommandsService } from "./commands.service";
import { EventsController } from "./events.controller";
import { PresenceController } from "./presence.controller";
import { StreamAccessService } from "./stream-access.service";

/** Command log: apply column/card actions, delta catch-up, SSE (TASK-26/30). */
@Module({
  imports: [AuthModule, RealtimeModule],
  controllers: [CommandsController, EventsController, PresenceController],
  providers: [CommandsService, MembershipGuard, StreamAccessService],
  // Reused by the master panel to edit board content as the owner (TASK-43).
  exports: [CommandsService],
})
export class CommandsModule {}
