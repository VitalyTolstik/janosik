import { Global, Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { queuesEnabled } from "@/ops/queue-core";
import { EmailSettingsService } from "./email-settings.service";
import { MAIL_QUEUE, MailQueueService } from "./mail-queue.service";
import { MailProcessor } from "./mail.processor";
import { MailerService } from "./mailer.service";

/**
 * Mail (TASK-51). Global so both the auth contour (email-change codes) and
 * the admin contour (email-change notices) can inject `MailerService`
 * without repeating the import. `EmailSettingsService` (TASK-52) adds the
 * master-panel data plane for hot-reconfigurable transport settings.
 * TASK-67: transactional letters go through the `mail` queue when Redis is
 * configured, with the in-process drain as the self-host/test fallback.
 */
@Global()
@Module({
  imports: queuesEnabled
    ? [BullModule.registerQueue({ name: MAIL_QUEUE })]
    : [],
  providers: [
    MailerService,
    EmailSettingsService,
    MailQueueService,
    ...(queuesEnabled ? [MailProcessor] : []),
  ],
  exports: [MailerService, EmailSettingsService, MailQueueService],
})
export class MailerModule {}
