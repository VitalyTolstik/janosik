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
})
export class CommandsModule {}
