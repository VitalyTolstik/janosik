/**
 * Bilingual announcements: the locale/policy vocabulary and the single
 * content resolver used by the backend, the admin preview and the banner.
 *
 * One logical announcement keeps its identity, audience, schedule and read
 * state; its text lives in `AnnouncementTranslation` rows. A missing
 * translation may be served in the source language, but only with
 * `isFallback: true` so the UI can show an explicit notice — the resolver
 * never silently pretends that foreign text is the viewer's language.
 */

/** Languages the announcement editor and resolver support in the MVP. */
export const ANNOUNCEMENT_LOCALES = ["en", "ru"] as const;
export type AnnouncementLocale = (typeof ANNOUNCEMENT_LOCALES)[number];

/**
 * `require_all` (default) refuses to publish until both EN and RU exist.
 * `allow_fallback` intentionally publishes a single language and shows the
 * explicit fallback notice to everyone whose language is missing.
 */
export const ANNOUNCEMENT_FALLBACK_POLICIES = [
  "require_all",
  "allow_fallback",
] as const;
export type AnnouncementFallbackPolicy =
  (typeof ANNOUNCEMENT_FALLBACK_POLICIES)[number];

export type AnnouncementTranslationOrigin = "human" | "ai_draft" | "legacy";

export interface AnnouncementTranslationLike {
  locale: string;
  title: string;
  body: string;
  origin?: AnnouncementTranslationOrigin | string;
  reviewedAt?: number | null;
  updatedAt?: number;
}

export interface AnnouncementContent {
  title: string;
  body: string;
  /** Language of the text actually returned; `null` for legacy rows. */
  contentLocale: AnnouncementLocale | null;
  /** Always true when `contentLocale` differs from the requested locale. */
  isFallback: boolean;
}

export function isAnnouncementLocale(
  value: unknown,
): value is AnnouncementLocale {
  return value === "en" || value === "ru";
}

export function isAnnouncementFallbackPolicy(
  value: unknown,
): value is AnnouncementFallbackPolicy {
  return value === "require_all" || value === "allow_fallback";
}

/**
 * A translation counts only when both parts carry text. AI drafts additionally
 * need a human review; human and legacy rows are complete by construction.
 */
export function translationComplete(
  translation: AnnouncementTranslationLike,
): boolean {
  return (
    translation.title.trim().length > 0 &&
    translation.body.trim().length > 0 &&
    (translation.origin !== "ai_draft" || translation.reviewedAt != null)
  );
}

/** Which of the required languages currently have a publishable version. */
export function completeness(
  translations: AnnouncementTranslationLike[],
): Record<AnnouncementLocale, boolean> {
  return {
    en: translations.some(
      (translation) =>
        translation.locale === "en" && translationComplete(translation),
    ),
    ru: translations.some(
      (translation) =>
        translation.locale === "ru" && translationComplete(translation),
    ),
  };
}

/**
 * Resolve what one viewer should see. The resolver intentionally does not
 * consult the fallback policy: that policy governs publishing. If a published
 * row is nevertheless incomplete, returning a marked fallback is safer than
 * hiding the announcement or showing foreign text without a notice.
 */
export function resolveAnnouncementContent(input: {
  requestedLocale: AnnouncementLocale;
  sourceLocale: AnnouncementLocale | null;
  translations: AnnouncementTranslationLike[];
  legacy?: { title: string | null; body: string | null };
}): AnnouncementContent | null {
  const complete = input.translations.filter(translationComplete);
  const exact = complete.find(
    (translation) => translation.locale === input.requestedLocale,
  );
  if (exact) {
    return {
      title: exact.title,
      body: exact.body,
      contentLocale: exact.locale as AnnouncementLocale,
      isFallback: false,
    };
  }

  const source = input.sourceLocale
    ? complete.find((translation) => translation.locale === input.sourceLocale)
    : undefined;
  if (source) {
    return {
      title: source.title,
      body: source.body,
      contentLocale: source.locale as AnnouncementLocale,
      isFallback: source.locale !== input.requestedLocale,
    };
  }

  // A legacy row has no known language: serve it as the original, with no
  // notice, exactly like the pre-localization banner did.
  if (input.legacy?.title && input.legacy?.body) {
    return {
      title: input.legacy.title,
      body: input.legacy.body,
      contentLocale: null,
      isFallback: false,
    };
  }

  const any = complete[0];
  if (any) {
    return {
      title: any.title,
      body: any.body,
      contentLocale: any.locale as AnnouncementLocale,
      isFallback: any.locale !== input.requestedLocale,
    };
  }

  return null;
}

/**
 * Full fallback phrase in the recipient's UI language. Kept as complete
 * sentences rather than “only in” + a declined language name, so adding a
 * third language never breaks grammar.
 */
export function announcementFallbackNotice(
  recipientLocale: AnnouncementLocale,
  contentLocale: AnnouncementLocale | null,
): string {
  if (recipientLocale === "ru") {
    return contentLocale === "en"
      ? "Это объявление доступно только на английском."
      : "Это объявление доступно только на русском.";
  }
  return contentLocale === "ru"
    ? "This announcement is available in Russian only."
    : "This announcement is available in English only.";
}

/** Localized subject prefix used only when the content language differs. */
export function announcementFallbackSubjectPrefix(
  recipientLocale: AnnouncementLocale,
  contentLocale: AnnouncementLocale,
): string {
  if (recipientLocale === "ru") {
    return contentLocale === "en"
      ? "Объявление (только на английском): "
      : "Объявление (только на русском): ";
  }
  return contentLocale === "ru"
    ? "Announcement (Russian only): "
    : "Announcement (English only): ";
}

/**
 * The primary text an admin list shows: the original translation, then the
 * legacy columns, then any translation. Used for the compatibility
 * `title`/`body` fields on the admin DTO.
 */
export function announcementPrimaryContent(input: {
  sourceLocale: AnnouncementLocale | null;
  translations: AnnouncementTranslationLike[];
  legacy?: { title: string | null; body: string | null };
}): { title: string; body: string } {
  const source = input.sourceLocale
    ? input.translations.find(
        (translation) => translation.locale === input.sourceLocale,
      )
    : undefined;
  if (source) return { title: source.title, body: source.body };
  if (input.legacy?.title != null || input.legacy?.body != null) {
    return {
      title: input.legacy.title ?? "",
      body: input.legacy.body ?? "",
    };
  }
  const first = input.translations[0];
  return first
    ? { title: first.title, body: first.body }
    : { title: "", body: "" };
}
