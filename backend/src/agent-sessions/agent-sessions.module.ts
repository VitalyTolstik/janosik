import { Module } from "@nestjs/common";
import { AuthModule } from "@/auth/auth.module";
import { BoardWriteModule } from "@/common/board-write.module";
import { MembershipGuard } from "@/common/membership.guard";
import { RealtimeModule } from "@/realtime/realtime.module";
import {
  AccountAgentsController,
  BoardAgentsController,
} from "./agent-pause.controller";
import { AgentSessionsController } from "./agent-sessions.controller";
import { AgentSessionsService } from "./agent-sessions.service";

/** TASK-166.1: agent sessions, attribution and the `X-Agent-Session` contract. */
@Module({
  imports: [AuthModule, BoardWriteModule, RealtimeModule],
  controllers: [
    AgentSessionsController,
    BoardAgentsController,
    AccountAgentsController,
  ],
  providers: [AgentSessionsService, MembershipGuard],
  exports: [AgentSessionsService],
})
export class AgentSessionsModule {}
