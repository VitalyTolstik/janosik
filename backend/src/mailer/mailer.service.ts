import { Injectable, Logger } from "@nestjs/common";
import { createTransport, type Transporter } from "nodemailer";
import { env } from "@/config/env";
import type { SentEmail } from "./mail.types";

const OUTBOX_LIMIT = 50;

/**
 * Outgoing email (TASK-51). Two modes:
 *
 * - `SMTP_HOST` configured → real SMTP via nodemailer (the de-facto Node
 *   standard) with STARTTLS/implicit TLS as configured.
 * - Not configured → emails are written to the server log and kept in an
 *   in-memory `outbox` (a console-backend, like Rails' letter_opener for
 *   development). Self-hosters get a bootable system without any mail
 *   setup; e2e tests read codes from `outbox` instead of an inbox.
 *
 * Every send is best-effort from the caller's perspective: the service
 * throws on transport errors so the auth flow can surface a clean 503
 * instead of pretending a code was delivered.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly transporter: Transporter | null;
  /** Ring buffer of the last emails — dev introspection and e2e tests. */
  readonly outbox: SentEmail[] = [];

  constructor() {
    this.transporter =
      env.SMTP_HOST === ""
        ? null
        : createTransport({
            host: env.SMTP_HOST,
            port: env.SMTP_PORT,
            secure: env.SMTP_SECURE,
            auth:
              env.SMTP_USER === ""
                ? undefined
                : { user: env.SMTP_USER, pass: env.SMTP_PASS },
          });
    if (this.transporter === null) {
      this.logger.warn(
        "SMTP_HOST is not set — outgoing emails are logged to the server log, never sent. Configure SMTP_* in backend/.env to enable delivery.",
      );
    } else {
      this.logger.log(
        `SMTP transport ready: ${env.SMTP_HOST}:${env.SMTP_PORT}`,
      );
    }
  }

  get enabled(): boolean {
    return this.transporter !== null;
  }

  from(): string {
    return env.SMTP_FROM;
  }

  async send(email: {
    to: string;
    subject: string;
    text: string;
    html: string;
  }) {
    if (this.transporter === null) {
      this.outbox.push(email);
      if (this.outbox.length > OUTBOX_LIMIT) this.outbox.shift();
      this.logger.log(
        `[mail suppressed] to=${email.to} subject="${email.subject}"\n${email.text}`,
      );
      return;
    }
    try {
      await this.transporter.sendMail({
        from: env.SMTP_FROM,
        ...email,
      });
    } catch (cause) {
      this.logger.error(
        `Failed to send email to ${email.to}: ${String(cause)}`,
      );
      throw cause;
    }
  }
}
