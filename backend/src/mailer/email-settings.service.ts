import {
  Injectable,
  BadRequestException,
  Logger,
  OnModuleInit,
} from "@nestjs/common";
import type {
  AdminEmailSettingsDto,
  AdminUpdateEmailSettingsRequest,
  EMAIL_SMTP_PRESET_IDS,
} from "@janosik/shared";
import { EMAIL_SMTP_PRESETS, EMAIL_SMTP_TEST_PRESETS } from "@janosik/shared";
import { env } from "@/config/env";
import { PrismaService } from "@/common/prisma/prisma.service";
import type { SmtpConfig } from "./mail.types";
import { MailerService } from "./mailer.service";
import { decryptSecret, encryptSecret } from "./secret-box";

type ProviderId = (typeof EMAIL_SMTP_PRESET_IDS)[number];

const SETTINGS_ID = "singleton";

/**
 * Saved mail transport settings (TASK-52) — the data plane behind the
 * "Email service" page in the master panel. The owner picks a provider
 * preset and credentials; this service validates, encrypts the password
 * (AES-256-GCM, see secret-box), persists the singleton row and swaps the
 * live transporter — delivery flips without touching code, env or the
 * process. Priority: saved enabled row → SMTP_* env bootstrap → log mode.
 */
@Injectable()
export class EmailSettingsService implements OnModuleInit {
  private readonly logger = new Logger(EmailSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
  ) {}

  /** Re-apply a saved enabled row after a restart (hot-reload is per-run). */
  async onModuleInit(): Promise<void> {
    const row = await this.prisma.emailSettings.findUnique({
      where: { id: SETTINGS_ID },
    });
    if (row === null || !row.enabled) return;
    // A password is required for every real provider; the `mailpit` sandbox
    // is anonymous and safe to re-apply without one.
    if (row.passwordEnc === null && row.provider !== "mailpit") return;
    try {
      this.mailer.reconfigure(this.toConfig(row), row.from);
      this.logger.log(
        `Saved mail settings applied: ${row.provider} (${row.host}:${row.port})`,
      );
    } catch (cause) {
      // A stale encrypted password must not brick the boot — log and fall
      // back to the env bootstrap / log mode.
      this.logger.error(
        `Saved mail settings could not be applied: ${String(cause)}`,
      );
    }
  }

  /**
   * The saved row, or the env bootstrap, or nothing — with masked secret.
   */
  async getPublic(): Promise<AdminEmailSettingsDto> {
    const row = await this.prisma.emailSettings.findUnique({
      where: { id: SETTINGS_ID },
    });
    if (row !== null) {
      return {
        provider: row.provider as ProviderId,
        host: row.host,
        port: row.port,
        secure: row.secure,
        from: row.from,
        username: row.username,
        enabled: row.enabled,
        hasPassword: row.passwordEnc !== null,
        source: "db",
        active:
          row.enabled &&
          (row.provider === "mailpit" || row.passwordEnc !== null) &&
          this.mailer.enabled,
        lastTestAt: row.lastTestAt?.toISOString() ?? null,
        lastTestOk: row.lastTestOk,
        lastError: row.lastError,
        updatedBy: row.updatedBy,
        updatedAt: row.updatedAt.toISOString(),
        webViewer: this.webViewer(row),
      };
    }
    const envActive = env.SMTP_HOST !== "";
    return {
      provider: "custom",
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      from: env.SMTP_FROM,
      username: env.SMTP_USER,
      enabled: envActive,
      hasPassword: false,
      source: envActive ? "env" : "none",
      active: envActive,
      lastTestAt: null,
      lastTestOk: null,
      lastError: null,
      updatedBy: null,
      updatedAt: null,
      webViewer: null,
    };
  }

  /** Sandbox web inbox (Mailpit) — a fixed localhost URL, no credentials. */
  private webViewer(row: {
    provider: string;
  }): AdminEmailSettingsDto["webViewer"] {
    if (row.provider !== "mailpit") return null;
    const preset = EMAIL_SMTP_TEST_PRESETS.find((p) => p.id === "mailpit");
    return preset === undefined ? null : { url: preset.helpUrl };
  }

  /**
   * Validates, stores and applies new settings. `password === undefined`
   * keeps the stored one, `null` clears it, a string replaces it. With the
   * `mailpit` sandbox there are no credentials at all: the transport is
   * anonymous, `username`/`password` are ignored and enabling needs neither.
   */
  async update(
    input: AdminUpdateEmailSettingsRequest,
    updatedBy: string,
  ): Promise<AdminEmailSettingsDto> {
    const preset = [...EMAIL_SMTP_PRESETS, ...EMAIL_SMTP_TEST_PRESETS].find(
      (p) => p.id === input.provider,
    );
    if (preset === undefined) {
      throw new BadRequestException("Unknown provider preset");
    }
    const sandbox = preset.id === "mailpit";
    const host =
      preset.id === "custom" ? (input.host ?? "").trim() : preset.host;
    const port = preset.id === "custom" ? input.port : preset.port;
    const secure =
      preset.id === "custom" ? (input.secure ?? false) : preset.secure;

    const rowBefore = await this.prisma.emailSettings.findUnique({
      where: { id: SETTINGS_ID },
    });

    let username: string;
    let from: string;
    let passwordEnc: string | null;
    if (sandbox) {
      // Anonymous local catcher — no username, no password, nothing minted.
      username = "";
      from =
        input.from.trim() === ""
          ? "Janosik <no-reply@janosik.local>"
          : input.from.trim();
      passwordEnc = null;
    } else {
      username = input.username.trim();
      from = input.from.trim();
      const storedPassword = rowBefore?.passwordEnc ?? null;
      if (
        input.enabled &&
        input.password === undefined &&
        storedPassword === null
      ) {
        throw new BadRequestException(
          "An SMTP password is required to enable delivery",
        );
      }
      if (input.enabled && input.password === null) {
        throw new BadRequestException(
          "Delivery cannot be enabled without an SMTP password",
        );
      }
      passwordEnc = storedPassword;
      if (input.password !== undefined) {
        passwordEnc =
          input.password === null || input.password === ""
            ? null
            : encryptSecret(input.password);
      }
    }

    if (host === "" || port === undefined) {
      throw new BadRequestException("SMTP host and port are required");
    }
    if (from === "" || (!sandbox && username === "")) {
      throw new BadRequestException(
        "From address and SMTP username are required",
      );
    }

    const row = await this.prisma.emailSettings.upsert({
      where: { id: SETTINGS_ID },
      create: {
        id: SETTINGS_ID,
        provider: preset.id,
        host,
        port,
        secure,
        from,
        username,
        passwordEnc,
        enabled: input.enabled,
        updatedBy,
      },
      update: {
        provider: preset.id,
        host,
        port,
        secure,
        from,
        username,
        passwordEnc,
        enabled: input.enabled,
        updatedBy,
        // A settings change invalidates the previous probe result.
        lastTestAt: null,
        lastTestOk: null,
        lastError: null,
      },
    });

    if (input.enabled && (sandbox || passwordEnc !== null)) {
      this.mailer.reconfigure(this.toConfig(row), row.from);
    } else {
      this.mailer.reconfigure(null, row.from);
    }
    return this.getPublic();
  }

  /**
   * Sends a probe email through the live transport. Never throws — the
   * outcome (including the transport error) is returned and recorded on
   * the row so the panel can show it next to the settings.
   */
  async test(to: string): Promise<{ ok: boolean; error: string | null }> {
    const subject = "Janosik — test email / Тестовое письмо";
    const text =
      "This is a test email from the Janosik master panel. " +
      "If you received it, outgoing mail delivery works.\n\n" +
      "Это тестовое письмо из панели администратора Janosik. " +
      "Если вы его получили — отправка почты работает.";
    const html =
      "<p>This is a test email from the <strong>Janosik</strong> master panel. If you received it, outgoing mail delivery works.</p>" +
      '<p style="color:#6b7280">Это тестовое письмо из панели администратора Janosik. Если вы его получили — отправка почты работает.</p>';
    try {
      await this.mailer.send({ to, subject, text, html });
      await this.recordTest(true, null);
      return { ok: true, error: null };
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      await this.recordTest(false, error);
      return { ok: false, error };
    }
  }

  private async recordTest(ok: boolean, error: string | null): Promise<void> {
    const existing = await this.prisma.emailSettings.findUnique({
      where: { id: SETTINGS_ID },
    });
    if (existing === null) return; // env bootstrap — nothing to annotate
    await this.prisma.emailSettings.update({
      where: { id: SETTINGS_ID },
      data: { lastTestAt: new Date(), lastTestOk: ok, lastError: error },
    });
  }

  private toConfig(row: {
    host: string;
    port: number;
    secure: boolean;
    username: string;
    passwordEnc: string | null;
  }): SmtpConfig {
    return {
      host: row.host,
      port: row.port,
      secure: row.secure,
      username: row.username,
      // The `mailpit` sandbox is anonymous (passwordEnc null, username "");
      // buildTransport then omits auth entirely.
      password: row.passwordEnc === null ? "" : decryptSecret(row.passwordEnc),
    };
  }
}
