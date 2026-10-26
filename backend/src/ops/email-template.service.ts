import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import type { MailLocale } from "@/mailer/mail.types";
import {
  EMAIL_TEMPLATE_DEFAULTS,
  emailChangeCodeEmail,
  emailChangedNoticeEmail,
  fillTemplate,
  htmlToText,
  verificationCodeEmail,
} from "@/mailer/templates";

/** Editable mail templates (TASK-62). */
export const EMAIL_TEMPLATE_KEYS = [
  { key: "verification_code", label: "Email verification code" },
  { key: "email_change_code", label: "Email change code" },
  { key: "email_changed_notice", label: "Email changed notice" },
] as const;

export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number]["key"];

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * Wraps the built-in letter builders so an operator-edited row (TASK-62)
 * overrides the code template without a redeploy. The built-in builder is
 * the fallback: with no override the behaviour is byte-for-byte unchanged.
 */
@Injectable()
export class EmailTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  private async row(key: EmailTemplateKey) {
    return this.prisma.emailTemplate.findUnique({ where: { key } });
  }

  async list() {
    const rows = await this.prisma.emailTemplate.findMany();
    const byKey = new Map(rows.map((row) => [row.key, row]));
    return EMAIL_TEMPLATE_KEYS.map((entry) => {
      const row = byKey.get(entry.key);
      const fallback = EMAIL_TEMPLATE_DEFAULTS[entry.key];
      return {
        key: entry.key,
        label: entry.label,
        // No override → show the built-in letter so the editor is never empty.
        subject: row?.subject ?? fallback?.subject ?? "",
        bodyHtml: row?.bodyHtml ?? fallback?.bodyHtml ?? "",
        placeholders: fallback?.placeholders ?? [],
        custom: row !== undefined,
        updatedBy: row?.updatedBy ?? null,
        updatedAt: row?.updatedAt.getTime() ?? null,
      };
    });
  }

  async update(
    key: string,
    patch: { subject: string; bodyHtml: string },
    updatedBy: string,
  ) {
    const row = await this.prisma.emailTemplate.upsert({
      where: { key },
      create: { key, ...patch, updatedBy },
      update: { ...patch, updatedBy },
    });
    return {
      key: row.key,
      subject: row.subject,
      bodyHtml: row.bodyHtml,
      placeholders: EMAIL_TEMPLATE_DEFAULTS[key]?.placeholders ?? [],
      custom: true,
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt.getTime(),
    };
  }

  /** Drop an override so the built-in letter takes over again. */
  async reset(key: string) {
    await this.prisma.emailTemplate.deleteMany({ where: { key } });
    const entry = EMAIL_TEMPLATE_KEYS.find((row) => row.key === key);
    const fallback = EMAIL_TEMPLATE_DEFAULTS[key];
    return {
      key,
      label: entry?.label ?? key,
      subject: fallback?.subject ?? "",
      bodyHtml: fallback?.bodyHtml ?? "",
      placeholders: fallback?.placeholders ?? [],
      custom: false,
      updatedBy: null,
      updatedAt: null,
    };
  }

  /** Verification code letter, honouring an override when one is saved. */
  async verificationEmail(
    code: string,
    minutes: number,
    locale: MailLocale,
  ): Promise<RenderedEmail> {
    const row = await this.row("verification_code");
    if (row) {
      const vars = { code, minutes };
      const subject = fillTemplate(row.subject, vars);
      const html = fillTemplate(row.bodyHtml, vars);
      return { subject, text: htmlToText(html), html };
    }
    return verificationCodeEmail(code, minutes, locale);
  }

  /** Email-change code letter (override-aware, mirrors verification). */
  async emailChangeEmail(
    code: string,
    minutes: number,
    locale: MailLocale,
  ): Promise<RenderedEmail> {
    const row = await this.row("email_change_code");
    if (row) {
      const vars = { code, minutes };
      const subject = fillTemplate(row.subject, vars);
      const html = fillTemplate(row.bodyHtml, vars);
      return { subject, text: htmlToText(html), html };
    }
    return emailChangeCodeEmail(code, minutes, locale);
  }

  async emailChangedNotice(
    newEmail: string,
    locale: MailLocale,
  ): Promise<RenderedEmail> {
    const row = await this.row("email_changed_notice");
    if (row) {
      const vars = { email: newEmail };
      const subject = fillTemplate(row.subject, vars);
      const html = fillTemplate(row.bodyHtml, vars);
      return { subject, text: htmlToText(html), html };
    }
    return emailChangedNoticeEmail(newEmail, locale);
  }
}
