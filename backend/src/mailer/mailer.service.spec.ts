import { Logger } from "@nestjs/common";

jest.mock("@/config/env", () => ({
  env: {
    NODE_ENV: "production",
    SMTP_HOST: "",
    SMTP_FROM: "Janosik <no-reply@janosik.local>",
  },
}));

import { MailerService } from "./mailer.service";

/**
 * TASK-147 (B19): with no SMTP transport the mailer logs outgoing mail. In
 * production that log must not contain the body — and the code templates put
 * the code in the *subject* too, so the subject must not leak either.
 */
describe("MailerService production logging", () => {
  it("withholds the code from both the body and the subject in production", async () => {
    const service = new MailerService();
    const log = jest
      .spyOn((service as unknown as { logger: Logger }).logger, "log")
      .mockImplementation(() => undefined);

    await service.send({
      to: "victim@example.com",
      // The real templates put the code in the subject, not just the body
      // (`templates.ts`: "Janosik: confirmation code 123456").
      subject: "Janosik: confirmation code 123456",
      text: "Your verification code is 123456",
      html: "<p>123456</p>",
    });

    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]?.[0] ?? "");
    expect(line).toContain("victim@example.com");
    expect(line).not.toContain("123456");
    // The in-memory outbox still carries the full message (dev/e2e probe).
    expect(service.outbox[0]?.text).toContain("123456");
    expect(service.outbox[0]?.subject).toContain("123456");
  });
});
