import { Module } from "@nestjs/common";
import { AuthModule } from "@/auth/auth.module";
import { CardAccessGuard } from "@/common/card-access.guard";
import { MembershipGuard } from "@/common/membership.guard";
import { ActivityController } from "./activity.controller";
import { ActivityService } from "./activity.service";

/** Activity feeds over the command log (§7.2, TASK-28). */
@Module({
  imports: [AuthModule],
  controllers: [ActivityController],
  providers: [ActivityService, MembershipGuard, CardAccessGuard],
})
export class ActivityModule {}
