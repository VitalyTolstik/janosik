import { describe, expect, it } from "vitest";

import {
  announcementFallbackNotice,
  announcementFallbackSubjectPrefix,
  announcementPrimaryContent,
  completeness,
  isAnnouncementFallbackPolicy,
  isAnnouncementLocale,
  resolveAnnouncementContent,
  translationComplete,
  type AnnouncementTranslationLike,
} from "./announcements";

const human = (
  locale: string,
  title = `${locale} title`,
  body = `${locale} body`,
): AnnouncementTranslationLike => ({
  locale,
  title,
  body,
  origin: "human",
});

describe("announcements", () => {
  it("recognizes only the supported locales and policies", () => {
    expect(isAnnouncementLocale("en")).toBe(true);
    expect(isAnnouncementLocale("ru")).toBe(true);
    expect(isAnnouncementLocale("ru-RU")).toBe(false);
    expect(isAnnouncementLocale("fr")).toBe(false);
    expect(isAnnouncementLocale(null)).toBe(false);

    expect(isAnnouncementFallbackPolicy("require_all")).toBe(true);
    expect(isAnnouncementFallbackPolicy("allow_fallback")).toBe(true);
    expect(isAnnouncementFallbackPolicy("anything")).toBe(false);
  });

  it("treats whitespace-only and unreviewed AI drafts as incomplete", () => {
    expect(translationComplete(human("en"))).toBe(true);
    expect(
      translationComplete({ locale: "en", title: " ", body: "body" }),
    ).toBe(false);
    expect(
      translationComplete({ locale: "en", title: "title", body: "\n" }),
    ).toBe(false);
    expect(
      translationComplete({
        locale: "en",
        title: "title",
        body: "body",
        origin: "ai_draft",
        reviewedAt: null,
      }),
    ).toBe(false);
    expect(
      translationComplete({
        locale: "en",
        title: "title",
        body: "body",
        origin: "ai_draft",
        reviewedAt: 1,
      }),
    ).toBe(true);
  });

  it("reports completeness per locale", () => {
    expect(completeness([human("ru")])).toEqual({ en: false, ru: true });
    expect(completeness([human("en"), human("ru")])).toEqual({
      en: true,
      ru: true,
    });
    expect(
      completeness([
        human("en"),
        {
          locale: "ru",
          title: "черновик",
          body: "текст",
          origin: "ai_draft",
          reviewedAt: null,
        },
      ]),
    ).toEqual({ en: true, ru: false });
  });

  it("returns the exact translation when the viewer's language exists", () => {
    expect(
      resolveAnnouncementContent({
        requestedLocale: "ru",
        sourceLocale: "en",
        translations: [human("en"), human("ru")],
      }),
    ).toEqual({
      title: "ru title",
      body: "ru body",
      contentLocale: "ru",
      isFallback: false,
    });
  });

  it("falls back to the source language and marks it", () => {
    expect(
      resolveAnnouncementContent({
        requestedLocale: "en",
        sourceLocale: "ru",
        translations: [human("ru")],
      }),
    ).toEqual({
      title: "ru title",
      body: "ru body",
      contentLocale: "ru",
      isFallback: true,
    });
  });

  it("serves legacy content without a notice and with an unknown locale", () => {
    expect(
      resolveAnnouncementContent({
        requestedLocale: "en",
        sourceLocale: null,
        translations: [],
        legacy: { title: "Старое", body: "Текст" },
      }),
    ).toEqual({
      title: "Старое",
      body: "Текст",
      contentLocale: null,
      isFallback: false,
    });
  });

  it("prefers an exact translation over legacy text", () => {
    expect(
      resolveAnnouncementContent({
        requestedLocale: "en",
        sourceLocale: null,
        translations: [human("en")],
        legacy: { title: "Legacy", body: "Legacy body" },
      }),
    ).toMatchObject({ title: "en title", contentLocale: "en" });
  });

  it("uses any complete translation as a last resort", () => {
    expect(
      resolveAnnouncementContent({
        requestedLocale: "en",
        sourceLocale: "en",
        translations: [human("ru")],
      }),
    ).toMatchObject({
      contentLocale: "ru",
      isFallback: true,
    });
  });

  it("returns null when there is nothing readable", () => {
    expect(
      resolveAnnouncementContent({
        requestedLocale: "en",
        sourceLocale: null,
        translations: [],
      }),
    ).toBeNull();
  });

  it("builds the compatibility title/body from source, legacy or first text", () => {
    expect(
      announcementPrimaryContent({
        sourceLocale: "ru",
        translations: [human("en"), human("ru")],
      }),
    ).toEqual({ title: "ru title", body: "ru body" });
    expect(
      announcementPrimaryContent({
        sourceLocale: null,
        translations: [],
        legacy: { title: "Old", body: null },
      }),
    ).toEqual({ title: "Old", body: "" });
    expect(
      announcementPrimaryContent({
        sourceLocale: null,
        translations: [human("ru")],
      }),
    ).toEqual({ title: "ru title", body: "ru body" });
    expect(
      announcementPrimaryContent({ sourceLocale: null, translations: [] }),
    ).toEqual({ title: "", body: "" });
  });

  it("keeps the fallback phrases complete per language", () => {
    expect(announcementFallbackNotice("en", "ru")).toBe(
      "This announcement is available in Russian only.",
    );
    expect(announcementFallbackNotice("ru", "en")).toBe(
      "Это объявление доступно только на английском.",
    );
    expect(announcementFallbackSubjectPrefix("en", "ru")).toBe(
      "Announcement (Russian only): ",
    );
    expect(announcementFallbackSubjectPrefix("ru", "en")).toBe(
      "Объявление (только на английском): ",
    );
  });
});
