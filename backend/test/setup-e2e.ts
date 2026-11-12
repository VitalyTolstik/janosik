import { MailerService } from "@/mailer/mailer.service";

/**
 * `config/env.ts` clears SMTP_* in tests, while registration and email
 * change deliberately refuse to run without a transport (TASK-53). Give
 * every e2e suite a simulated live transport by default: `send()` still
 * lands in the mailer outbox, where the specs read their codes from.
 *
 * Suites that exercise the "no mail" behaviour override the instance getter
 * (see `registration-verification.e2e-spec.ts`).
 */
if (process.env.NODE_ENV === "test") {
  jest
    .spyOn(MailerService.prototype, "enabled", "get")
    .mockReturnValue(true);
}

/**
 * Most suites create board members through `POST /auth/register` and are
 * not about the mailbox gate. Verify those accounts at creation so an
 * invitation can be accepted; the verification suite clears the flag to
 * exercise the real unverified path.
 */
if (process.env.NODE_ENV === "test") {
  process.env.E2E_AUTO_VERIFY = "1";
}
