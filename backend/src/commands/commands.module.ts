import { Module } from "@nestjs/common";
import { AuthModule } from "@/auth/auth.module";
import { MembershipGuard } from "@/common/membership.guard";
import { CommandsController } from "./commands.controller";
import { CommandsService } from "./commands.service";

/** Command log: apply column/card actions, delta catch-up (§7.2, TASK-26). */
@Module({
  imports: [AuthModule],
  controllers: [CommandsController],
  providers: [CommandsService, MembershipGuard],
  // Reused by the master panel to edit board content as the owner (TASK-43).
  exports: [CommandsService],
})
export class CommandsModule {}
