import { describe, expect, it } from "vitest";

import {
  commentPlainExcerpt,
  extractMentionUserIds,
  mentionHref,
  mentionIdFromHref,
  mentionMarkdown,
  parseCommentMentions,
  sanitizeMentionLabel,
  stripMentionMarkup,
} from "./mentions";

describe("comment mentions (TASK-177.12)", () => {
  it("builds an explicit token and parses it back", () => {
    const token = mentionMarkdown("Alice Smith", "user-1");

    expect(token).toBe(
      "[@Alice Smith](https://janosik.invalid/mention/user-1)",
    );
    expect(mentionHref("user-1")).toBe(
      "https://janosik.invalid/mention/user-1",
    );
    expect(mentionIdFromHref("https://janosik.invalid/mention/user-1")).toBe(
      "user-1",
    );
    expect(parseCommentMentions(`Hi ${token}, look`)).toEqual([
      {
        userId: "user-1",
        label: "Alice Smith",
        index: 3,
        length: token.length,
      },
    ]);
  });

  it("deduplicates repeated mentions in first-mention order", () => {
    const text = `${mentionMarkdown("Bob", "user-2")} and ${mentionMarkdown(
      "Alice",
      "user-1",
    )} and ${mentionMarkdown("Bob again", "user-2")}`;

    expect(extractMentionUserIds(text)).toEqual(["user-2", "user-1"]);
  });

  it("does not treat bare @name text as a mention", () => {
    const text = "Hi @Alice and mail alice@example.com";

    expect(parseCommentMentions(text)).toEqual([]);
    expect(extractMentionUserIds(text)).toEqual([]);
  });

  it("rejects malformed ids and lookalike links", () => {
    expect(
      parseCommentMentions(
        "[@Alice](https://janosik.invalid/mention/../etc/passwd)",
      ),
    ).toEqual([]);
    expect(
      parseCommentMentions("[@Alice](https://example.com/mention/user-1)"),
    ).toEqual([]);
    expect(mentionIdFromHref("https://example.com/mention/user-1")).toBeNull();
    expect(
      mentionIdFromHref("https://janosik.invalid/mention/user-1?next=evil"),
    ).toBeNull();
    expect(mentionIdFromHref("https://janosik.invalid/")).toBeNull();
    expect(mentionIdFromHref(null)).toBeNull();
  });

  it("keeps Unicode labels and strips link-breaking characters", () => {
    expect(sanitizeMentionLabel(" Анна [Lead]\\\n ")).toBe("Анна Lead");
    expect(mentionMarkdown("Анна", "user-1")).toBe(
      "[@Анна](https://janosik.invalid/mention/user-1)",
    );
    expect(mentionMarkdown("[[[", "user-1")).toBe(
      "[@member](https://janosik.invalid/mention/user-1)",
    );
  });

  it("turns mention markup into readable plain text", () => {
    const text = `Ping ${mentionMarkdown("Alice", "user-1")} — see [the plan](https://example.com)`;
    expect(stripMentionMarkup(text)).toContain("@Alice");
    expect(commentPlainExcerpt(text)).toBe("Ping @Alice — see the plan");
  });

  it("bounds an excerpt and removes HTML so a row stays plain text", () => {
    const text = `<img src=x onerror=alert(1)> ${"word ".repeat(80)}`;
    const excerpt = commentPlainExcerpt(text, 40);

    expect(excerpt.length).toBeLessThanOrEqual(40);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt).not.toContain("<");
  });
});
