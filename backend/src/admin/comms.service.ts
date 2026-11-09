import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  ANNOUNCEMENT_LOCALES,
  announcementPrimaryContent,
  completeness,
  isAnnouncementFallbackPolicy,
  isAnnouncementLocale,
  resolveAnnouncementContent,
  type AdminAnnouncementDto,
  type AdminAnnouncementTranslationDto,
  type AdminCreateAnnouncementRequest,
  type AdminEmailTemplateDto,
  type AdminSendEmailResponse,
  type AdminUpdateAnnouncementRequest,
  type AnnouncementDto,
  type AnnouncementFallbackPolicy,
  type AnnouncementLocale,
  type AnnouncementTranslationLike,
  type AnnouncementTranslationOrigin,
} from "@janosik/shared";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";
import { pickLocale, type MailLocale } from "@/mailer/mail.types";
import { announcementEmail } from "@/mailer/templates";
import { MailerService } from "@/mailer/mailer.service";
import { BroadcastQueueService } from "@/ops/broadcast-queue.service";
import { EmailTemplateService } from "@/ops/email-template.service";

const TITLE_MAX = 200;
const BODY_MAX = 2000;

type AnnouncementWithTranslations = Prisma.AnnouncementGetPayload<{
  include: { translations: true };
}>;

type TranslationRow = AnnouncementWithTranslations["translations"][number];

interface TranslationInput {
  locale: AnnouncementLocale;
  title: string;
  body: string;
  origin?: AnnouncementTranslationOrigin;
  reviewedAt?: Date | null;
}

interface RecipientProfile {
  email: string;
  locale: MailLocale | null;
}

function isMailLocale(value: unknown): value is MailLocale {
  return value === "en" || value === "ru";
}

/**
 * Communications (TASK-62): user mail, in-app announcements and the editable
 * mail templates.
 *
 * Announcements are one logical row with per-locale translations. Publishing
 * is strict by default (EN + RU); `allow_fallback` is an explicit exception
 * that serves the original language together with a localized notice. Email
 * is resolved per recipient from `User.locale`, never from the author's
 * language or the browser's `Accept-Language`.
 */
@Injectable()
export class CommsService {
  private readonly logger = new Logger(CommsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly templates: EmailTemplateService,
    private readonly broadcasts: BroadcastQueueService,
  ) {}

  // --------------------------------------------------------- announcements

  /** Map a Prisma announcement row to the admin wire shape. */
  toAnnouncement(row: AnnouncementWithTranslations): AdminAnnouncementDto {
    const translations = row.translations
      .filter(
        (
          translation,
        ): translation is TranslationRow & {
          locale: AnnouncementLocale;
        } => isAnnouncementLocale(translation.locale),
      )
      .map((translation) => this.toTranslationDto(translation));
    const sourceLocale = isAnnouncementLocale(row.sourceLocale)
      ? row.sourceLocale
      : null;
    const primary = announcementPrimaryContent({
      sourceLocale,
      translations,
      legacy: { title: row.title, body: row.body },
    });
    return {
      id: row.id,
      title: primary.title,
      body: primary.body,
      sourceLocale,
      fallbackPolicy: isAnnouncementFallbackPolicy(row.fallbackPolicy)
        ? row.fallbackPolicy
        : "require_all",
      translations,
      completeness: completeness(translations),
      level: row.level as AdminAnnouncementDto["level"],
      audience: row.audience as AdminAnnouncementDto["audience"],
      segment: row.segment,
      active: row.active,
      sendEmail: row.sendEmail,
      emailSentAt: row.emailSentAt?.getTime() ?? null,
      startsAt: row.startsAt?.getTime() ?? null,
      endsAt: row.endsAt?.getTime() ?? null,
      version: row.version,
      createdBy: row.createdBy,
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    };
  }

  private toTranslationDto(
    row: TranslationRow & { locale: AnnouncementLocale },
  ): AdminAnnouncementTranslationDto {
    return {
      locale: row.locale,
      title: row.title,
      body: row.body,
      origin:
        row.origin === "ai_draft" || row.origin === "legacy"
          ? row.origin
          : "human",
      translatedFrom: isAnnouncementLocale(row.translatedFrom)
        ? row.translatedFrom
        : null,
      sourceUpdatedAt: row.sourceUpdatedAt?.getTime() ?? null,
      reviewedAt: row.reviewedAt?.getTime() ?? null,
      updatedAt: row.updatedAt.getTime(),
      updatedBy: row.updatedBy,
    };
  }

  /** Prisma rows → the shared resolver's structural input. */
  private translationLikes(
    rows: TranslationRow[],
  ): AnnouncementTranslationLike[] {
    return rows
      .filter((row) => isAnnouncementLocale(row.locale))
      .map((row) => ({
        locale: row.locale,
        title: row.title,
        body: row.body,
        origin: row.origin,
        reviewedAt: row.reviewedAt?.getTime() ?? null,
        updatedAt: row.updatedAt.getTime(),
      }));
  }

  async listAnnouncements(): Promise<AdminAnnouncementDto[]> {
    const rows = await this.prisma.announcement.findMany({
      include: { translations: true },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => this.toAnnouncement(row));
  }

  async createAnnouncement(
    dto: AdminCreateAnnouncementRequest,
    createdBy: string,
  ): Promise<AdminAnnouncementDto> {
    const active = dto.active ?? true;
    const parsed = this.parseCreate(dto);
    this.assertWindow(parsed.startsAt, parsed.endsAt);
    this.assertPublishable({
      active,
      fallbackPolicy: parsed.fallbackPolicy,
      sourceLocale: parsed.sourceLocale,
      translations: parsed.translations,
      legacy: parsed.legacy,
    });

    let row = await this.prisma.announcement.create({
      data: {
        title: parsed.legacy?.title ?? null,
        body: parsed.legacy?.body ?? null,
        sourceLocale: parsed.sourceLocale,
        fallbackPolicy: parsed.fallbackPolicy,
        level: dto.level ?? "info",
        audience: dto.audience ?? "all",
        segment: dto.segment ?? null,
        active,
        sendEmail: dto.sendEmail ?? false,
        startsAt: parsed.startsAt,
        endsAt: parsed.endsAt,
        createdBy,
        ...(parsed.translations.length > 0
          ? {
              translations: {
                create: parsed.translations.map((translation) => ({
                  ...translation,
                  origin: "human",
                  reviewedAt: new Date(),
                  updatedBy: createdBy,
                })),
              },
            }
          : {}),
      },
      include: { translations: true },
    });

    // Publishing is the only moment a letter may leave. A draft stays silent;
    // activation through PATCH later reuses the same path.
    if (row.active && row.sendEmail) {
      row = await this.claimAndScheduleEmail(row);
    }
    return this.toAnnouncement(row);
  }

  async updateAnnouncement(
    id: string,
    dto: AdminUpdateAnnouncementRequest,
    updatedBy?: string,
  ): Promise<{
    announcement: AdminAnnouncementDto;
    changedLocales: AnnouncementLocale[];
    legacyChanged: boolean;
  }> {
    const exists = await this.prisma.announcement.findUnique({
      where: { id },
      include: { translations: true },
    });
    if (!exists) throw new NotFoundException("Announcement not found");
    if (dto.version !== undefined && dto.version !== exists.version) {
      throw new ConflictException({
        statusCode: 409,
        conflict: "version",
        currentVersion: exists.version,
        message: "The announcement was changed by someone else",
      });
    }

    const active = dto.active ?? exists.active;
    // Turning the checkbox on while the announcement is already live is a
    // no-op in the publish pipeline (only draft → active may send). Reject it
    // instead of leaving a silent `email pending` badge.
    if (
      active &&
      exists.active &&
      dto.sendEmail === true &&
      !exists.sendEmail &&
      exists.emailSentAt === null
    ) {
      throw this.badRequest(
        "announcement_email_active_noop",
        "An active announcement cannot send email on save; save it as a draft and publish again",
      );
    }
    const fallbackPolicy =
      dto.fallbackPolicy ??
      (isAnnouncementFallbackPolicy(exists.fallbackPolicy)
        ? exists.fallbackPolicy
        : "require_all");
    let sourceLocale =
      dto.sourceLocale !== undefined
        ? dto.sourceLocale
        : isAnnouncementLocale(exists.sourceLocale)
          ? exists.sourceLocale
          : null;

    const translations = new Map<AnnouncementLocale, TranslationInput>();
    for (const translation of exists.translations) {
      if (!isAnnouncementLocale(translation.locale)) continue;
      translations.set(translation.locale, {
        locale: translation.locale,
        title: translation.title,
        body: translation.body,
        origin:
          translation.origin === "ai_draft" || translation.origin === "legacy"
            ? translation.origin
            : "human",
        reviewedAt: translation.reviewedAt,
      });
    }

    // `null` is accepted by the validation pipe as "optional" but must behave
    // like an omitted field, not crash `Object.entries`.
    const translationPatch = dto.translations ?? undefined;
    let legacyTitle = exists.title;
    let legacyBody = exists.body;
    const isLegacyRow =
      exists.sourceLocale === null && exists.translations.length === 0;

    if (translationPatch !== undefined) {
      for (const [rawLocale, value] of Object.entries(translationPatch)) {
        if (!isAnnouncementLocale(rawLocale)) {
          throw this.badRequest(
            "announcement_locale_unsupported",
            `Unsupported announcement locale: ${rawLocale}`,
            { locale: rawLocale },
          );
        }
        if (value === null) {
          translations.delete(rawLocale);
        } else {
          translations.set(rawLocale, this.parseTranslation(rawLocale, value));
        }
      }
    }

    const legacyPayload =
      translationPatch === undefined &&
      (dto.title !== undefined || dto.body !== undefined);

    if (legacyPayload) {
      const targetLocale =
        sourceLocale ?? dto.sourceLocale ?? ("en" as AnnouncementLocale);
      const existing = translations.get(targetLocale);
      const title = (dto.title ?? existing?.title ?? legacyTitle ?? "").trim();
      const body = (dto.body ?? existing?.body ?? legacyBody ?? "").trim();
      if (!isAnnouncementLocale(targetLocale)) {
        throw this.badRequest(
          "announcement_source_locale_required",
          "Choose the source language of the announcement",
        );
      }
      if (title.length === 0 || body.length === 0) {
        throw this.badRequest(
          "announcement_translations_incomplete",
          "Both title and body are required",
          { missingLocales: [targetLocale] },
        );
      }
      if (
        isLegacyRow &&
        dto.sourceLocale === undefined &&
        exists.sourceLocale === null
      ) {
        // Old clients keep editing old rows exactly as before; choosing a
        // source language is an explicit migration step.
        legacyTitle = title;
        legacyBody = body;
      } else {
        translations.set(targetLocale, {
          locale: targetLocale,
          title,
          body,
        });
        sourceLocale = targetLocale;
        legacyTitle = null;
        legacyBody = null;
      }
    }

    // Explicitly choosing a source language migrates legacy text into the
    // translations table instead of guessing the old row's language.
    if (
      dto.sourceLocale !== undefined &&
      dto.sourceLocale !== null &&
      isLegacyRow &&
      exists.title !== null &&
      exists.body !== null
    ) {
      if (!translations.has(dto.sourceLocale)) {
        translations.set(dto.sourceLocale, {
          locale: dto.sourceLocale,
          title: exists.title,
          body: exists.body,
        });
      }
      sourceLocale = dto.sourceLocale;
      legacyTitle = null;
      legacyBody = null;
    }

    if (sourceLocale !== null && !translations.has(sourceLocale)) {
      throw this.badRequest(
        "announcement_source_translation_required",
        "The source language must have a complete translation",
        { missingLocales: [sourceLocale] },
      );
    }

    const finalTranslations = [...translations.values()];
    if (sourceLocale === null && finalTranslations.length > 0) {
      throw this.badRequest(
        "announcement_source_locale_required",
        "Choose the source language of the announcement",
      );
    }
    if (
      finalTranslations.length === 0 &&
      !(legacyTitle?.trim() && legacyBody?.trim()) &&
      dto.sourceLocale === undefined
    ) {
      throw this.badRequest(
        "announcement_translations_required",
        "At least one language version is required",
      );
    }

    // `require_all` is a promise that both languages exist. A legacy row has
    // no known source yet, so allowing strict mode on it would produce a
    // misleading "EN+RU" badge while publishing source-less content.
    if (
      finalTranslations.length === 0 &&
      legacyTitle?.trim() &&
      legacyBody?.trim() &&
      fallbackPolicy === "require_all"
    ) {
      throw this.badRequest(
        "announcement_source_locale_required",
        "Choose the source language before enabling strict publishing",
      );
    }

    this.assertWindow(
      dto.startsAt !== undefined
        ? dto.startsAt === null
          ? null
          : new Date(dto.startsAt)
        : exists.startsAt,
      dto.endsAt !== undefined
        ? dto.endsAt === null
          ? null
          : new Date(dto.endsAt)
        : exists.endsAt,
    );
    this.assertPublishable({
      active,
      fallbackPolicy,
      sourceLocale,
      translations: finalTranslations,
      legacy:
        legacyTitle !== null || legacyBody !== null
          ? { title: legacyTitle, body: legacyBody }
          : null,
    });

    const existingLocales = new Set(
      exists.translations
        .map((translation) => translation.locale)
        .filter(isAnnouncementLocale),
    );
    const removedLocales = [...existingLocales].filter(
      (locale) => !translations.has(locale),
    );
    // Touch only the versions whose text actually changed: editing the RU
    // copy must not bump the EN row's updatedAt/staleness metadata.
    const changedTranslations = finalTranslations.filter((translation) => {
      const current = exists.translations.find(
        (row) => row.locale === translation.locale,
      );
      return (
        current === undefined ||
        current.title !== translation.title ||
        current.body !== translation.body
      );
    });
    const sourceRow = exists.translations.find(
      (translation) => translation.locale === sourceLocale,
    );
    const sourceUpdatedAt = new Date();
    const finalSendEmail = dto.sendEmail ?? exists.sendEmail;
    // Claim the letter atomically with the draft → active transition. The
    // actual recipient fan-out happens after this request returns; a retry
    // sees `emailSentAt` set and cannot duplicate the broadcast.
    const sendNow =
      !exists.active &&
      active &&
      finalSendEmail &&
      exists.emailSentAt === null &&
      this.mailer.enabled;
    const legacyChanged =
      (legacyTitle ?? null) !== (exists.title ?? null) ||
      (legacyBody ?? null) !== (exists.body ?? null);

    const data: Prisma.AnnouncementUpdateInput = {
      sourceLocale,
      fallbackPolicy,
      level: dto.level ?? exists.level,
      audience: dto.audience ?? exists.audience,
      segment: dto.segment !== undefined ? dto.segment : exists.segment,
      active,
      sendEmail: finalSendEmail,
      ...(sendNow ? { emailSentAt: new Date() } : {}),
      version: { increment: 1 },
      startsAt:
        dto.startsAt !== undefined
          ? dto.startsAt === null
            ? null
            : new Date(dto.startsAt)
          : exists.startsAt,
      endsAt:
        dto.endsAt !== undefined
          ? dto.endsAt === null
            ? null
            : new Date(dto.endsAt)
          : exists.endsAt,
      title: legacyTitle,
      body: legacyBody,
    };

    const row = await this.prisma.$transaction(async (tx) => {
      if (removedLocales.length > 0) {
        await tx.announcementTranslation.deleteMany({
          where: { announcementId: id, locale: { in: removedLocales } },
        });
      }
      for (const translation of changedTranslations) {
        const isSource = translation.locale === sourceLocale;
        await tx.announcementTranslation.upsert({
          where: {
            announcementId_locale: {
              announcementId: id,
              locale: translation.locale,
            },
          },
          create: {
            announcementId: id,
            locale: translation.locale,
            title: translation.title,
            body: translation.body,
            origin: "human",
            translatedFrom: isSource ? null : sourceLocale,
            sourceUpdatedAt: isSource
              ? null
              : (sourceRow?.updatedAt ?? sourceUpdatedAt),
            reviewedAt: sourceUpdatedAt,
            updatedBy: updatedBy ?? null,
          },
          update: {
            title: translation.title,
            body: translation.body,
            origin: "human",
            translatedFrom: isSource ? null : sourceLocale,
            sourceUpdatedAt: isSource
              ? null
              : (sourceRow?.updatedAt ?? sourceUpdatedAt),
            reviewedAt: sourceUpdatedAt,
            updatedBy: updatedBy ?? null,
          },
        });
      }
      const updated = await tx.announcement.updateMany({
        where: { id, version: exists.version },
        data,
      });
      if (updated.count === 0) {
        throw new ConflictException({
          statusCode: 409,
          conflict: "version",
          currentVersion: exists.version,
          message: "The announcement was changed by someone else",
        });
      }
      return tx.announcement.findUniqueOrThrow({
        where: { id },
        include: { translations: true },
      });
    });

    if (sendNow) {
      // Fire-and-forget: the HTTP response must not wait for recipient lookup
      // or SMTP/queue drains. `emailSentAt` above is the durable claim.
      void this.dispatchLocalizedEmail(row);
    }
    return {
      announcement: this.toAnnouncement(row),
      changedLocales: [
        ...changedTranslations.map((translation) => translation.locale),
        ...removedLocales,
      ],
      legacyChanged,
    };
  }

  async deleteAnnouncement(id: string): Promise<void> {
    await this.prisma.announcement.delete({ where: { id } }).catch(() => {
      throw new NotFoundException("Announcement not found");
    });
  }

  /** Active announcements for the signed-in user's app banner. */
  async activeFor(
    email: string,
    options: {
      locale?: string;
      userLocale?: AnnouncementLocale | null;
      acceptLanguage?: string;
    } = {},
  ): Promise<AnnouncementDto[]> {
    const requestedLocale: AnnouncementLocale = isAnnouncementLocale(
      options.locale,
    )
      ? options.locale
      : isAnnouncementLocale(options.userLocale)
        ? options.userLocale
        : pickLocale(options.acceptLanguage);
    const now = new Date();
    const rows = await this.prisma.announcement.findMany({
      where: {
        active: true,
        OR: [{ startsAt: null }, { startsAt: { lte: now } }],
        AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
      },
      include: { translations: true },
      orderBy: { createdAt: "desc" },
    });
    return rows
      .filter(
        (row) =>
          row.audience === "all" ||
          (row.segment ?? "")
            .split(",")
            .map((entry) => entry.trim().toLowerCase())
            .includes(email.toLowerCase()),
      )
      .flatMap((row) => {
        const content = resolveAnnouncementContent({
          requestedLocale,
          sourceLocale: isAnnouncementLocale(row.sourceLocale)
            ? row.sourceLocale
            : null,
          translations: this.translationLikes(row.translations),
          legacy: { title: row.title, body: row.body },
        });
        if (!content) {
          this.logger.warn(
            `Announcement ${row.id} has no readable content for ${requestedLocale}`,
          );
          return [];
        }
        return [
          {
            id: row.id,
            title: content.title,
            body: content.body,
            level: row.level as AnnouncementDto["level"],
            contentLocale: content.contentLocale,
            requestedLocale,
            isFallback: content.isFallback,
          },
        ];
      });
  }

  // ------------------------------------------------------- announcement io

  private parseCreate(dto: AdminCreateAnnouncementRequest): {
    sourceLocale: AnnouncementLocale | null;
    fallbackPolicy: AnnouncementFallbackPolicy;
    translations: TranslationInput[];
    legacy: { title: string; body: string } | null;
    startsAt: Date | null;
    endsAt: Date | null;
  } {
    const hasTranslations = dto.translations !== undefined;
    const hasLegacy = dto.title !== undefined || dto.body !== undefined;
    if (!hasTranslations && !hasLegacy) {
      throw this.badRequest(
        "announcement_translations_required",
        "Provide translations or the legacy title/body",
      );
    }

    let sourceLocale: AnnouncementLocale | null = null;
    let fallbackPolicy: AnnouncementFallbackPolicy;
    let translations: TranslationInput[];
    let legacy: { title: string; body: string } | null = null;

    if (hasTranslations) {
      if (!isAnnouncementLocale(dto.sourceLocale)) {
        throw this.badRequest(
          "announcement_source_locale_required",
          "Choose the source language of the announcement",
        );
      }
      sourceLocale = dto.sourceLocale;
      fallbackPolicy = dto.fallbackPolicy ?? "require_all";
      translations = [];
      for (const [rawLocale, value] of Object.entries(dto.translations ?? {})) {
        if (!isAnnouncementLocale(rawLocale)) {
          throw this.badRequest(
            "announcement_locale_unsupported",
            `Unsupported announcement locale: ${rawLocale}`,
            { locale: rawLocale },
          );
        }
        if (value === null) {
          throw this.badRequest(
            "announcement_translation_incomplete",
            "A new announcement cannot contain an empty translation",
            { missingLocales: [rawLocale] },
          );
        }
        translations.push(this.parseTranslation(rawLocale, value));
      }
      if (translations.length === 0) {
        throw this.badRequest(
          "announcement_translations_required",
          "At least one language version is required",
        );
      }
    } else {
      const title = dto.title?.trim() ?? "";
      const body = dto.body?.trim() ?? "";
      if (title.length === 0 || body.length === 0) {
        throw this.badRequest(
          "announcement_translations_incomplete",
          "Both title and body are required",
        );
      }
      if (isAnnouncementLocale(dto.sourceLocale)) {
        // A caller that names the source language gets the normal translation
        // path. Old admin bundles never send this field.
        sourceLocale = dto.sourceLocale;
        fallbackPolicy = dto.fallbackPolicy ?? "allow_fallback";
        translations = [{ locale: sourceLocale, title, body }];
      } else {
        // The pre-localization payload carries no language. Keeping it as a
        // true legacy row is the only honest choice: inventing `en` would show
        // Russian text to EN users without a notice (and the reverse notice in
        // the RU banner/email). The admin migrates it explicitly in the editor.
        sourceLocale = null;
        fallbackPolicy = "allow_fallback";
        translations = [];
        legacy = { title, body };
      }
    }

    return {
      sourceLocale,
      fallbackPolicy,
      translations,
      legacy,
      startsAt: dto.startsAt != null ? new Date(dto.startsAt) : null,
      endsAt: dto.endsAt != null ? new Date(dto.endsAt) : null,
    };
  }

  private parseTranslation(
    locale: AnnouncementLocale,
    value: { title: string; body: string } | null,
  ): TranslationInput {
    if (value === null || typeof value !== "object") {
      throw this.badRequest(
        "announcement_translation_incomplete",
        "Translation must contain a title and a body",
        { missingLocales: [locale] },
      );
    }
    const title = typeof value.title === "string" ? value.title.trim() : "";
    const body = typeof value.body === "string" ? value.body.trim() : "";
    if (title.length === 0 || body.length === 0) {
      throw this.badRequest(
        "announcement_translations_incomplete",
        "Both title and body are required",
        { missingLocales: [locale] },
      );
    }
    if (title.length > TITLE_MAX || body.length > BODY_MAX) {
      throw this.badRequest(
        "announcement_translation_too_long",
        `Title is limited to ${TITLE_MAX} and body to ${BODY_MAX} characters`,
        { locale },
      );
    }
    return { locale, title, body };
  }

  private assertPublishable(input: {
    active: boolean;
    fallbackPolicy: AnnouncementFallbackPolicy;
    sourceLocale: AnnouncementLocale | null;
    translations: TranslationInput[];
    legacy: { title: string | null; body: string | null } | null;
  }): void {
    if (!input.active) {
      if (
        input.translations.length === 0 &&
        !(input.legacy?.title && input.legacy?.body)
      ) {
        throw this.badRequest(
          "announcement_translations_required",
          "At least one language version is required",
        );
      }
      return;
    }

    // Legacy rows have no known language and are always allowed until an admin
    // migrates them; this is the backward-compatibility escape hatch.
    if (
      input.translations.length === 0 &&
      input.legacy?.title &&
      input.legacy?.body
    ) {
      return;
    }

    const available = completeness(
      input.translations.map((translation) => ({
        ...translation,
        reviewedAt: translation.reviewedAt?.getTime() ?? null,
      })),
    );
    if (input.fallbackPolicy === "require_all") {
      const missingLocales = ANNOUNCEMENT_LOCALES.filter(
        (locale) => !available[locale],
      );
      if (missingLocales.length > 0) {
        throw this.badRequest(
          "announcement_translations_incomplete",
          "Both languages are required before publishing",
          { missingLocales },
        );
      }
      return;
    }

    if (input.sourceLocale === null) {
      throw this.badRequest(
        "announcement_source_locale_required",
        "Choose the source language of the announcement",
      );
    }
    if (!available[input.sourceLocale]) {
      throw this.badRequest(
        "announcement_translations_incomplete",
        "The source language must be complete before publishing",
        { missingLocales: [input.sourceLocale] },
      );
    }
  }

  private assertWindow(startsAt: Date | null, endsAt: Date | null): void {
    if (startsAt !== null && endsAt !== null && startsAt >= endsAt) {
      throw this.badRequest(
        "announcement_window_invalid",
        "The end time must be after the start time",
      );
    }
  }

  private badRequest(
    code: string,
    message: string,
    extra: Record<string, unknown> = {},
  ): BadRequestException {
    return new BadRequestException({
      statusCode: 400,
      code,
      message,
      ...extra,
    });
  }

  // ------------------------------------------------------ announcement mail

  /** Resolves the inbox list and per-recipient language. */
  private async recipientProfiles(
    audience: string,
    segment: string | null,
  ): Promise<RecipientProfile[]> {
    if (audience === "segment") {
      const entries = [
        ...new Set(
          (segment ?? "")
            .split(",")
            .map((entry) => entry.trim().toLowerCase())
            .filter((entry) => entry.length > 0),
        ),
      ];
      if (entries.length === 0) return [];
      const users = await this.prisma.user.findMany({
        where: { email: { in: entries } },
        select: { email: true, locale: true, disabledAt: true },
      });
      const byEmail = new Map(
        users.map((user) => [user.email.toLowerCase(), user]),
      );
      return entries.flatMap((entry) => {
        const user = byEmail.get(entry);
        if (user?.disabledAt) return [];
        return [
          {
            email: user?.email ?? entry,
            locale: isMailLocale(user?.locale) ? user.locale : null,
          },
        ];
      });
    }
    const users = await this.prisma.user.findMany({
      where: { disabledAt: null },
      select: { email: true, locale: true },
    });
    return users.map((user) => ({
      email: user.email,
      locale: isMailLocale(user.locale) ? user.locale : null,
    }));
  }

  /**
   * Atomically claim the letter for a freshly published announcement, then
   * run the fan-out in the background. The claim is what makes a retried
   * request harmless: the next one sees `emailSentAt` already set.
   */
  private async claimAndScheduleEmail(
    row: AnnouncementWithTranslations,
  ): Promise<AnnouncementWithTranslations> {
    if (!this.mailer.enabled) return row;
    const claimed = await this.prisma.announcement.updateMany({
      where: {
        id: row.id,
        active: true,
        sendEmail: true,
        emailSentAt: null,
      },
      data: { emailSentAt: new Date() },
    });
    if (claimed.count === 0) return row;
    const current = await this.prisma.announcement.findUniqueOrThrow({
      where: { id: row.id },
      include: { translations: true },
    });
    void this.dispatchLocalizedEmail(current);
    return current;
  }

  /**
   * Background recipient fan-out. Never awaited by the admin request: SMTP
   * and a large `audience=all` must not hold the HTTP response open.
   */
  private async dispatchLocalizedEmail(
    row: AnnouncementWithTranslations,
  ): Promise<void> {
    if (!this.mailer.enabled) return;
    try {
      const recipients = await this.recipientProfiles(
        row.audience,
        row.segment,
      );
      interface Group {
        contentLocale: AnnouncementLocale | null;
        recipientLocale: MailLocale;
        isFallback: boolean;
        emails: string[];
      }
      const groups = new Map<string, Group>();
      const translationLikes = this.translationLikes(row.translations);
      for (const recipient of recipients) {
        const recipientLocale: MailLocale = recipient.locale ?? "en";
        const content = resolveAnnouncementContent({
          requestedLocale: recipientLocale,
          sourceLocale: isAnnouncementLocale(row.sourceLocale)
            ? row.sourceLocale
            : null,
          translations: translationLikes,
          legacy: { title: row.title, body: row.body },
        });
        if (!content) {
          this.logger.warn(
            `announcement_email_no_content id=${row.id} to=${recipient.email}`,
          );
          continue;
        }
        const key = `${content.contentLocale ?? "legacy"}:${recipientLocale}:${
          content.isFallback ? "fallback" : "exact"
        }`;
        const group = groups.get(key) ?? {
          contentLocale: content.contentLocale,
          recipientLocale,
          isFallback: content.isFallback,
          emails: [],
        };
        group.emails.push(recipient.email);
        groups.set(key, group);
      }

      for (const [key, group] of groups) {
        if (group.emails.length === 0) continue;
        const content = resolveAnnouncementContent({
          requestedLocale: group.recipientLocale,
          sourceLocale: isAnnouncementLocale(row.sourceLocale)
            ? row.sourceLocale
            : null,
          translations: translationLikes,
          legacy: { title: row.title, body: row.body },
        });
        if (!content) continue;
        const mail = announcementEmail({
          title: content.title,
          body: content.body,
          contentLocale: content.contentLocale,
          recipientLocale: group.recipientLocale,
          isFallback: content.isFallback,
        });
        await this.broadcasts.enqueue({
          // `row.id:key` is stable: a retry or a second dispatch of the same
          // group reuses the same deterministic job ids.
          id: `${row.id}:${key}`,
          emails: group.emails,
          ...mail,
        });
      }
    } catch (error) {
      this.logger.warn(
        `Announcement email ${row.id} failed: ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
    }
  }

  // ------------------------------------------------------------------- mail

  async sendEmail(
    to: string,
    subject: string,
    body: string,
  ): Promise<AdminSendEmailResponse> {
    const html = `<div>${body
      .split("\n")
      .map(
        (line) => `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`,
      )
      .join("")}</div>`;
    try {
      await this.mailer.send({ to, subject, text: body, html });
      return { ok: true, error: null };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Send failed",
      };
    }
  }

  async listTemplates(): Promise<AdminEmailTemplateDto[]> {
    return this.templates.list();
  }

  async updateTemplate(
    key: string,
    patch: { subject: string; bodyHtml: string },
    updatedBy: string,
  ): Promise<AdminEmailTemplateDto> {
    const row = await this.templates.update(key, patch, updatedBy);
    const catalog = await this.templates.list();
    const label = catalog.find((entry) => entry.key === key)?.label ?? key;
    return { ...row, label };
  }

  /** Drop the override so the built-in letter takes over again. */
  async resetTemplate(key: string): Promise<AdminEmailTemplateDto> {
    return this.templates.reset(key);
  }
}
