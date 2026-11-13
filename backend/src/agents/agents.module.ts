import { Module } from "@nestjs/common";
import { AuthModule } from "@/auth/auth.module";
import { AgentsOverviewController } from "./agents-overview.controller";
import { AgentsOverviewService } from "./agents-overview.service";

/** TASK-179.10 — read-only cross-board `/agents` aggregation. */
@Module({
  imports: [AuthModule],
  controllers: [AgentsOverviewController],
  providers: [AgentsOverviewService],
})
export class AgentsModule {}
