import { Global, Module } from "@nestjs/common";
import { EmailSettingsService } from "./email-settings.service";
import { MailerService } from "./mailer.service";

/**
 * Mail (TASK-51). Global so both the auth contour (email-change codes) and
 * the admin contour (email-change notices) can inject `MailerService`
 * without repeating the import. `EmailSettingsService` (TASK-52) adds the
 * master-panel data plane for hot-reconfigurable transport settings.
 */
@Global()
@Module({
  providers: [MailerService, EmailSettingsService],
  exports: [MailerService, EmailSettingsService],
})
export class MailerModule {}
