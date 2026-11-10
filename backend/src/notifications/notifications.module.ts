import { Global, Module } from "@nestjs/common";
import { AuthModule } from "@/auth/auth.module";
import { AttentionService } from "./attention.service";
import { NotificationsController } from "./notifications.controller";

/**
 * TASK-166.9 attention inbox. Global like `SecurityAuditModule`: approvals,
 * comments, board-quota errors and the maintenance sweep all record attention
 * events without threading the provider through every feature module.
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [AttentionService],
  exports: [AttentionService],
})
export class NotificationsModule {}
