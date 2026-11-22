import { describe, expect, it } from "vitest";

import en from "@/locales/en/translation.json";
import ru from "@/locales/ru/translation.json";
import { LABEL_COLORS } from "@janosik/shared";

/**
 * Catalog coverage for the i18n hardcode findings (H-1, H-4): every key the
 * components now resolve through `t()` must exist in both locales, so a
 * missing translation can't silently fall back to a raw English string.
 */

const CATALOGS: Record<string, Record<string, string>> = { en, ru };

describe("label color names (H-4)", () => {
  it("resolves every picker color in both locales", () => {
    for (const color of LABEL_COLORS) {
      for (const [locale, catalog] of Object.entries(CATALOGS)) {
        expect(
          catalog[`label.color.${color}`],
          `${locale}:label.color.${color}`,
        ).toBeTruthy();
      }
    }
  });
});

describe("common notification labels (H-1)", () => {
  it("resolves the toast aria labels in both locales", () => {
    for (const key of ["common.notifications", "common.dismissNotification"]) {
      for (const [locale, catalog] of Object.entries(CATALOGS)) {
        expect(catalog[key], `${locale}:${key}`).toBeTruthy();
      }
    }
  });
});

describe("TASK-156 conflict and access announcements", () => {
  it("resolves the title-conflict and deleted-board strings in both locales", () => {
    for (const key of [
      "card.titleConflict",
      "card.descriptionConflict",
      "card.descriptionConflictReload",
      "card.descriptionConflictKeep",
      "board.deleted",
      "dueDate.hoursLabel",
      "dueDate.minutesLabel",
    ]) {
      for (const [locale, catalog] of Object.entries(CATALOGS)) {
        expect(catalog[key], `${locale}:${key}`).toBeTruthy();
      }
    }
  });
});

describe("TASK-185.4 comment history", () => {
  const keys = [
    "comment.history.title",
    "comment.history.description",
    "comment.history.subtitle",
    "comment.history.open",
    "comment.history.listLabel",
    "comment.history.loading",
    "comment.history.loadError",
    "comment.history.retry",
    "comment.history.empty",
    "comment.history.showOlder",
    "comment.history.olderError",
    "comment.history.end",
    "comment.history.revision",
    "comment.history.editorUnavailable",
    "comment.history.cause.author_edit",
    "comment.history.cause.attachment_deleted",
    "comment.history.cause.system",
    "comment.history.before",
    "comment.history.after",
    "comment.history.showSnapshot",
    "comment.history.hideSnapshot",
    "comment.history.showSnapshotFor",
    "comment.history.hideSnapshotFor",
    "comment.history.snapshotRegion",
    "comment.history.fullVersion",
    "comment.history.banner.legacy",
    "comment.history.banner.generic",
    "comment.history.stale",
    "comment.history.refresh",
  ] as const;

  function placeholders(value: string): string[] {
    return [...value.matchAll(/\{\{(\w+)\}\}/g)]
      .map((match) => match[1])
      .sort();
  }

  it("has every card history string in EN and RU", () => {
    for (const key of keys) {
      for (const [locale, catalog] of Object.entries(CATALOGS)) {
        expect(catalog[key], `${locale}:${key}`).toBeTruthy();
      }
    }
  });

  it("keeps EN/RU placeholders in sync", () => {
    for (const key of keys) {
      expect(placeholders(en[key]), `en:${key}`).toEqual(placeholders(ru[key]));
    }
  });
});
