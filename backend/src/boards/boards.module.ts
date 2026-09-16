import { Module } from "@nestjs/common";
import { AuthModule } from "@/auth/auth.module";
import { MembershipGuard } from "@/common/membership.guard";
import { BoardsController } from "./boards.controller";
import { BoardsService } from "./boards.service";

/** Boards + membership + import/export (§7.2, TASK-25). */
@Module({
  imports: [AuthModule],
  controllers: [BoardsController],
  providers: [BoardsService, MembershipGuard],
})
export class BoardsModule {}
