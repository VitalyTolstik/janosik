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
 * production that log must not contain the body — it carries sign-in and
 * e-mail-change codes.
 */
describe("MailerService production logging", () => {
  it("withholds the body from the log but keeps it in the outbox", async () => {
    const service = new MailerService();
    const log = jest
      .spyOn((service as unknown as { logger: Logger }).logger, "log")
      .mockImplementation(() => undefined);

    await service.send({
      to: "victim@example.com",
      subject: "Your code",
      text: "Your verification code is 123456",
      html: "<p>123456</p>",
    });

    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]?.[0] ?? "");
    expect(line).toContain("victim@example.com");
    expect(line).not.toContain("123456");
    // The in-memory outbox still carries the full message (dev/e2e probe).
    expect(service.outbox[0]?.text).toContain("123456");
  });
});
