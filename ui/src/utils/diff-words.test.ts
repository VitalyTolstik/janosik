import { describe, expect, it } from "vitest";

import { diffSides } from "./diff-words";

/**
 * The history feed's word-diff (TASK-37): the changed fragment stands out,
 * the unchanged context shrinks to an ellipsis stub.
 */
const text = (segments: { text: string; kind: string }[]) =>
  segments.map((segment) => `${segment.kind}:${segment.text}`).join("|");

describe("diffSides", () => {
  it("marks the changed middle and keeps short context as is", () => {
    const sides = diffSides("Buy oat milk", "Buy oat milk 2l");
    expect(sides).not.toBeNull();
    expect(text(sides!.left)).toBe("same:Buy oat milk");
    expect(text(sides!.right)).toBe("same:Buy oat milk|added: 2l");
  });

  it("collapses long unchanged head and tail to ellipsis stubs", () => {
    const long = "0123456789".repeat(10); // 100 chars, no change
    const sides = diffSides(`${long}A${long}`, `${long}B${long}`);
    const left = sides!.left;
    expect(left).toHaveLength(3);
    expect(left[0].kind).toBe("same");
    expect(left[0].text).toBe(`…${long.slice(-12)}`);
    expect(left[1]).toEqual({ text: "A", kind: "removed" });
    expect(left[2].text).toBe(`${long.slice(0, 12)}…`);

    const right = sides!.right;
    expect(right[1]).toEqual({ text: "B", kind: "added" });
    expect(text(right)).toBe(text(left).replace("removed:A", "added:B"));
  });

  it("shows short context in full even at both ends", () => {
    const sides = diffSides("keep-old", "keep-new");
    expect(text(sides!.left)).toBe("same:keep-|removed:old");
    expect(text(sides!.right)).toBe("same:keep-|added:new");
  });

  it("handles pure additions and deletions", () => {
    const added = diffSides("hello ", "hello world");
    expect(text(added!.left)).toBe("same:hello ");
    expect(text(added!.right)).toBe("same:hello |added:world");

    const removed = diffSides("hello world", "hello ");
    expect(text(removed!.left)).toBe("same:hello |removed:world");
    expect(text(removed!.right)).toBe("same:hello ");
  });

  it("collapses the middle of an oversized changed fragment", () => {
    const sides = diffSides("x".repeat(300), "z".repeat(300));
    const left = sides!.left;
    expect(left).toHaveLength(1);
    expect(left[0].kind).toBe("removed");
    expect(left[0].text).toBe(`${"x".repeat(60)}…${"x".repeat(60)}`);
    expect(sides!.right[0]).toEqual({
      text: `${"z".repeat(60)}…${"z".repeat(60)}`,
      kind: "added",
    });
  });

  it("deals with a complete replacement (no common parts)", () => {
    const sides = diffSides("aaaa", "bbbb");
    expect(text(sides!.left)).toBe("removed:aaaa");
    expect(text(sides!.right)).toBe("added:bbbb");
  });

  it("finds the change inside one unbroken run of digits", () => {
    const from = "343434242432434343424243243434342424324";
    const to = `${from.slice(0, -3)}999`;
    const sides = diffSides(from, to);
    const context = `…${from.slice(0, -3).slice(-12)}`;
    expect(sides!.left).toEqual([
      { text: context, kind: "same" },
      { text: "324", kind: "removed" },
    ]);
    expect(sides!.right).toEqual([
      { text: context, kind: "same" },
      { text: "999", kind: "added" },
    ]);
  });

  it("returns null for equal texts", () => {
    expect(diffSides("same", "same")).toBeNull();
  });
});
