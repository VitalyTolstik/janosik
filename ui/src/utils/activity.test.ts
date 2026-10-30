import { describe, expect, it } from "vitest";

import en from "@/locales/en/translation.json";
import { FIELD_KEYS, formatChangeValue, sentenceFor } from "@/utils/activity";
import type { ActivityFeedEntry } from "@janosik/shared";

/**
 * Every board action the command log can store must render as a real
 * sentence, never the neutral "Changed the board" fallback. This is the
 * regression guard for the watch feed reading "Updated the card" on a
 * column/board command.
 */
const ACTION_TYPES = [
  // board + column
  "ADD_COLUMN",
  "RENAME_COLUMN",
  "DELETE_COLUMN",
  "MOVE_COLUMN",
  "SORT_COLUMN",
  "SET_COLUMN_CARD_ORDER",
  "SET_COLUMN_WIP_LIMIT",
  "ARCHIVE_COLUMN_CARDS",
  "DUPLICATE_COLUMN",
  "RENAME_BOARD",
  "ARCHIVE_BOARD",
  "UNARCHIVE_BOARD",
  "ADD_BOARD",
  "REMOVE_BOARD",
  "IMPORT_BOARDS",
  "RESTORE_BOARD",
  // card
  "ADD_CARD",
  "UPDATE_CARD",
  "TOUCH_CARD",
  "DELETE_CARD",
  "ARCHIVE_CARD",
  "UNARCHIVE_CARD",
  "DUPLICATE_CARD",
  "MOVE_CARD",
  "SET_CARD_DUE_DATE",
  "SET_CARD_PRIORITY",
  "SET_CARD_ASSIGN",
  "CLAIM_CARD",
  "SET_CARD_TASK_SPEC",
  "SET_CARD_COVER",
  "SET_CARD_LABEL",
  "ADD_CARD_LINK",
  "REMOVE_CARD_LINK",
  "RESTORE_CARD",
  // labels
  "ADD_LABEL",
  "RENAME_LABEL",
  "SET_LABEL_COLOR",
  "DELETE_LABEL",
  "RESTORE_LABEL",
  // checklists
  "ADD_CHECKLIST",
  "RENAME_CHECKLIST",
  "DELETE_CHECKLIST",
  "ADD_CHECKLIST_ITEM",
  "SET_CHECKLIST_ITEM_DONE",
  "RENAME_CHECKLIST_ITEM",
  "DELETE_CHECKLIST_ITEM",
  "RESTORE_CHECKLIST",
  "RESTORE_CHECKLIST_ITEM",
  "RESTORE_COLUMN",
  "RESTORE_COLUMN_CARDS",
] as const;

function entry(type: string): ActivityFeedEntry {
  return { source: "command", id: "x", at: 0, type, actorId: "u-1" };
}

describe("sentenceFor", () => {
  it.each(ACTION_TYPES)("maps %s to a real, translated sentence", (type) => {
    const { key } = sentenceFor(entry(type), "en", false);
    expect(key).not.toBe("activity.changed");
    expect(en).toHaveProperty(key);
  });

  it("falls back to a neutral board sentence for an unknown type", () => {
    expect(sentenceFor(entry("SOMETHING_NEW"), "en", false).key).toBe(
      "activity.changed",
    );
  });

  it("names a column add as a column change", () => {
    expect(sentenceFor(entry("ADD_COLUMN"), "en", false).key).toBe(
      "activity.column-added",
    );
  });

  it("reads a claim as claimed, a release as released", () => {
    const claimed: ActivityFeedEntry = {
      ...entry("CLAIM_CARD"),
      changes: [{ field: "claimedBy", from: null, to: "u-1" }],
    };
    const released: ActivityFeedEntry = {
      ...entry("CLAIM_CARD"),
      changes: [{ field: "claimedBy", from: "u-1", to: null }],
    };
    expect(sentenceFor(claimed, "en", false).key).toBe("activity.claimed");
    expect(sentenceFor(released, "en", false).key).toBe(
      "activity.claim-released",
    );
  });

  it.each([
    "member_invited",
    "member_role_changed",
    "member_expiry_changed",
    "member_removed",
  ] as const)("maps the membership event %s to a real sentence", (type) => {
    const { key } = sentenceFor(entry(type), "en", false);
    expect(key).not.toBe("activity.changed");
    expect(en).toHaveProperty(key);
  });

  it("has a translated label for every diff field", () => {
    for (const key of Object.values(FIELD_KEYS)) {
      expect(en).toHaveProperty(key);
    }
  });

  it("formats a membership expiry change as a date, not a raw ISO string", () => {
    const value = formatChangeValue(
      "expiresAt",
      "2026-11-01T09:00:00.000Z",
      "en",
      false,
    );
    expect(value).not.toBe("2026-11-01T09:00:00.000Z");
    expect(value).not.toContain("T");
  });
});
