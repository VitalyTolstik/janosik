import { describe, expect, it } from "vitest";

import {
  canOpenMentionAt,
  filterMentionMembers,
  isMentionTrigger,
  mentionPickerPlacement,
} from "./mentions";

describe("mention composer helpers (TASK-177.12)", () => {
  it("opens only at a word boundary, never inside an email or handle", () => {
    expect(canOpenMentionAt(null)).toBe(true);
    expect(canOpenMentionAt(" ")).toBe(true);
    expect(canOpenMentionAt("(")).toBe(true);
    expect(canOpenMentionAt(",")).toBe(true);
    expect(canOpenMentionAt("e")).toBe(false);
    expect(canOpenMentionAt("1")).toBe(false);
    expect(canOpenMentionAt("@")).toBe(false);
    expect(canOpenMentionAt(".")).toBe(false);
    expect(canOpenMentionAt("+")).toBe(false);
    expect(canOpenMentionAt("Ж")).toBe(false);
  });

  it("accepts plain, AltGr and Option @ but not shortcuts or IME", () => {
    const base = {
      key: "@",
      isComposing: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
    };
    expect(isMentionTrigger(base)).toBe(true);
    expect(isMentionTrigger({ ...base, altKey: true })).toBe(true);
    expect(isMentionTrigger({ ...base, ctrlKey: true, altKey: true })).toBe(
      true,
    );
    expect(isMentionTrigger({ ...base, ctrlKey: true })).toBe(false);
    expect(isMentionTrigger({ ...base, metaKey: true })).toBe(false);
    expect(isMentionTrigger({ ...base, isComposing: true })).toBe(false);
    expect(isMentionTrigger({ ...base, key: "a" })).toBe(false);
  });

  it("places the picker below, then flips above when the dialog runs out", () => {
    const below = mentionPickerPlacement(
      { top: 100, bottom: 160, left: 40, width: 500 },
      { width: 1024, height: 768 },
    );
    expect(below).toEqual({
      left: 40,
      width: 384,
      maxHeight: 320,
      top: 164,
    });

    const above = mentionPickerPlacement(
      { top: 600, bottom: 660, left: 40, width: 500 },
      { width: 1024, height: 768 },
    );
    expect(above).toMatchObject({ maxHeight: 320, bottom: 172 });
    expect(above.top).toBeUndefined();
  });

  it("clamps the picker inside a 390 px viewport", () => {
    const placement = mentionPickerPlacement(
      { top: 100, bottom: 160, left: 360, width: 500 },
      { width: 390, height: 700 },
    );
    expect(placement.width).toBe(374);
    expect(placement.left).toBe(8);
  });

  it("caps the candidate list only at render time", () => {
    const members = Array.from({ length: 11 }, (_, index) => ({
      userId: `u-${index}`,
      displayName: `User ${index}`,
      email: `u${index}@example.com`,
      role: "MEMBER" as const,
      expiresAt: null,
      avatarColor: null,
      avatarPath: null,
    }));
    expect(filterMentionMembers(members, "", 8)).toHaveLength(8);
    expect(
      filterMentionMembers(members, "", Number.MAX_SAFE_INTEGER),
    ).toHaveLength(11);
  });
});
