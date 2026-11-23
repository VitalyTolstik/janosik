import { Module } from "@nestjs/common";
import { ApprovalsModule } from "@/approvals/approvals.module";
import { AuthModule } from "@/auth/auth.module";
import { MembershipGuard } from "@/common/membership.guard";
import { RealtimeFlagGuard } from "@/realtime/realtime-flag.guard";
import { RealtimeModule } from "@/realtime/realtime.module";
import { CardIntentsController } from "./card-intents.controller";
import { CardIntentsService } from "./card-intents.service";
import { CommandsController } from "./commands.controller";
import { CommandsService } from "./commands.service";
import { EventsController } from "./events.controller";
import { PresenceController } from "./presence.controller";
import { StreamAccessService } from "./stream-access.service";

/** Command log: apply column/card actions, delta catch-up, SSE (TASK-26/30). */
@Module({
  imports: [AuthModule, RealtimeModule, ApprovalsModule],
  controllers: [
    CommandsController,
    CardIntentsController,
    EventsController,
    PresenceController,
  ],
  providers: [
    CommandsService,
    CardIntentsService,
    MembershipGuard,
    RealtimeFlagGuard,
    StreamAccessService,
  ],
  // Reused by the master panel to edit board content as the owner (TASK-43).
  exports: [CommandsService],
})
export class CommandsModule {}
