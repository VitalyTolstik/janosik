import { Global, Module } from "@nestjs/common";
import { MailerService } from "./mailer.service";

/**
 * Mail (TASK-51). Global so both the auth contour (email-change codes) and
 * the admin contour (email-change notices) can inject `MailerService`
 * without repeating the import.
 */
@Global()
@Module({
  providers: [MailerService],
  exports: [MailerService],
})
export class MailerModule {}
