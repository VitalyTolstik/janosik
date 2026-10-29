import { Injectable, Logger } from "@nestjs/common";
import { createTransport, type Transporter } from "nodemailer";
import { env } from "@/config/env";
import type { SentEmail, SmtpConfig } from "./mail.types";

const OUTBOX_LIMIT = 50;

/**
 * Outgoing email (TASK-51). Two modes:
 *
 * - transport configured → real SMTP via nodemailer (the de-facto Node
 *   standard) with STARTTLS/implicit TLS as configured;
 * - not configured → emails are written to the server log and kept in an
 *   in-memory `outbox` (a console-backend, like Rails' letter_opener for
 *   development). Self-hosters get a bootable system without any mail
 *   setup; e2e tests read codes from `outbox` instead of an inbox.
 *
 * Every send is best-effort from the caller's perspective: the service
 * throws on transport errors so the auth flow can surface a clean 503
 * instead of pretending a code was delivered.
 *
 * TASK-52: the transport is hot-swappable. The master panel saves new mail
 * settings and `reconfigure()` swaps the transporter in place — nodemailer
 * opens a connection per send, so there is nothing to drain and no process
 * restart. Boot-time config comes from the SMTP_* env; a saved enabled
 * settings row wins (see EmailSettingsService).
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private transporter: Transporter | null;
  private fromAddress: string;
  /** Ring buffer of the last emails — dev introspection and e2e tests. */
  readonly outbox: SentEmail[] = [];

  constructor() {
    this.fromAddress = env.SMTP_FROM;
    this.transporter =
      env.SMTP_HOST === ""
        ? null
        : MailerService.buildTransport({
            host: env.SMTP_HOST,
            port: env.SMTP_PORT,
            secure: env.SMTP_SECURE,
            username: env.SMTP_USER,
            password: env.SMTP_PASS,
          });
    if (this.transporter === null) {
      this.logger.warn(
        "SMTP_HOST is not set — outgoing emails are logged to the server log, never sent. Configure SMTP_* in backend/.env or the Email service page in the master panel to enable delivery.",
      );
    } else {
      this.logger.log(
        `SMTP transport ready: ${env.SMTP_HOST}:${env.SMTP_PORT}`,
      );
    }
  }

  /** Builds a transport from any config source (env bootstrap or DB row). */
  private static buildTransport(config: SmtpConfig): Transporter {
    return createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      // Keeps a misconfigured host from hanging sends for a minute.
      connectionTimeout: 10_000,
      auth:
        config.username === ""
          ? undefined
          : { user: config.username, pass: config.password },
    });
  }

  /**
   * Swaps the live transport at runtime (TASK-52). `null` returns the
   * mailer to log mode. In-flight sends keep their old transporter and
   * finish on their own; every later send picks up the new config.
   */
  reconfigure(config: SmtpConfig | null, from: string): void {
    this.fromAddress = from;
    this.transporter =
      config === null ? null : MailerService.buildTransport(config);
    if (config === null) {
      this.logger.warn(
        "Mail transport disabled — outgoing emails are logged to the server log, never sent.",
      );
    } else {
      this.logger.log(
        `SMTP transport ready: ${config.host}:${config.port} (configured from the master panel)`,
      );
    }
  }

  get enabled(): boolean {
    return this.transporter !== null;
  }

  from(): string {
    return this.fromAddress;
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
      // TASK-147 (B19): in production the log must never carry a message body
      // — sign-in and e-mail-change codes are in there. The *subject* carries
      // the code too (`templates.ts`: "confirmation code 123456"), so it is
      // withheld as well. Dev/e2e keep the full line for introspection.
      this.logger.log(
        env.NODE_ENV === "production"
          ? `[mail suppressed] to=${email.to} subject withheld (no SMTP configured)`
          : `[mail suppressed] to=${email.to} subject="${email.subject}"\n${email.text}`,
      );
      return;
    }
    try {
      await this.transporter.sendMail({
        from: this.fromAddress,
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
