import { describe, expect, it } from "vitest";

import {
  commentPlainExcerpt,
  extractMentionUserIds,
  isMentionHref,
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

  it("ignores mention-shaped text in fenced and inline code", () => {
    const token = mentionMarkdown("Alice", "user-1");
    const text = [
      `Ping ${token}`,
      "",
      "```md",
      `~~~text ${token}~~~`,
      "```",
      "",
      "Inline `" + token + "` stays text.",
    ].join("\n");

    expect(parseCommentMentions(text)).toEqual([
      expect.objectContaining({ userId: "user-1", label: "Alice" }),
    ]);
  });

  it("masks top-level, ≤3-space indented and blockquote fenced code", () => {
    const token = mentionMarkdown("Alice", "user-1");
    expect(parseCommentMentions(`~~~\n${token}\n~~~`)).toEqual([]);
    expect(parseCommentMentions("```\n" + token + "\n```")).toEqual([]);
    expect(parseCommentMentions(` ~~~\n ${token}\n ~~~`)).toEqual([]);
    expect(parseCommentMentions(`   ~~~\n   ${token}\n   ~~~`)).toEqual([]);
    expect(parseCommentMentions(`> ~~~\n> ${token}\n> ~~~`)).toEqual([]);
    expect(parseCommentMentions(`> > ~~~\n> > ${token}\n> > ~~~`)).toEqual([]);
  });

  it("treats 4-space and list-contained fences as ordinary text", () => {
    const token = mentionMarkdown("Alice", "user-1");
    const mentioned = [expect.objectContaining({ userId: "user-1" })];
    expect(parseCommentMentions(`    ~~~\n    ${token}\n    ~~~`)).toEqual(
      mentioned,
    );
    expect(parseCommentMentions(`- ~~~\n  ${token}\n  ~~~`)).toEqual(mentioned);
    expect(parseCommentMentions(`- [ ] ~~~\n  ${token}\n  ~~~`)).toEqual(
      mentioned,
    );
    expect(
      parseCommentMentions(["- > ~~~", `  > ${token}`, "  > ~~~"].join("\n")),
    ).toEqual(mentioned);
  });

  it("keeps explicit mention links in indented text live; only fenced/inline code suppresses", () => {
    const token = mentionMarkdown("Alice", "user-1");
    const mentioned = [expect.objectContaining({ userId: "user-1" })];
    // Indentation does not make an explicit link inert: only fenced and
    // inline code suppress it.
    expect(parseCommentMentions(`    ${token}`)).toEqual(mentioned);
    expect(parseCommentMentions(`    - ${token}`)).toEqual(mentioned);
    expect(parseCommentMentions(`>     ${token}`)).toEqual(mentioned);
    expect(parseCommentMentions(`-     ${token}`)).toEqual(mentioned);
    expect(parseCommentMentions(`- ${token}`)).toEqual(mentioned);
    expect(parseCommentMentions(`- parent\n\n      ${token}`)).toEqual(
      mentioned,
    );
  });

  it("ignores mention-shaped text inside HTML comments", () => {
    const token = mentionMarkdown("Alice", "user-1");
    expect(parseCommentMentions(`<!-- hidden ${token} -->`)).toEqual([]);
  });

  it("masks blockquote fenced code with tilde and backtick fences", () => {
    const token = mentionMarkdown("Alice", "user-1");
    expect(parseCommentMentions(`> ~~~\n> ${token}\n> ~~~`)).toEqual([]);
    expect(parseCommentMentions(`> \`\`\`\n> ${token}\n> \`\`\``)).toEqual([]);
    // A deeper quoted fence line is code content, not a closer.
    expect(parseCommentMentions(`~~~\n> ~~~\n${token}\n~~~`)).toEqual([]);
    expect(parseCommentMentions(`> ~~~\n> > ~~~\n> ${token}\n> ~~~`)).toEqual(
      [],
    );
  });

  it("ignores escaped tokens and keeps a double-escaped link live", () => {
    const token = mentionMarkdown("Alice", "user-1");
    expect(parseCommentMentions(`Literal \\${token}`)).toEqual([]);
    expect(
      parseCommentMentions(
        `Escaped ping \\[@Alice\\](${mentionHref("user-1")})`,
      ),
    ).toEqual([]);
    expect(parseCommentMentions(`Slash \\\\${token}`)).toEqual([
      expect.objectContaining({ userId: "user-1" }),
    ]);
  });

  it("ignores mention lookalikes embedded in a larger URL", () => {
    const token = mentionMarkdown("Alice", "user-1");
    expect(parseCommentMentions(`https://evil.test/${token} trailing`)).toEqual(
      [],
    );
    expect(parseCommentMentions(`${mentionHref("user-1")}?next=evil`)).toEqual(
      [],
    );
    expect(parseCommentMentions(`${mentionHref("user-1")}#fragment`)).toEqual(
      [],
    );
    expect(
      parseCommentMentions(`${mentionHref("user-1")} and ${token}`),
    ).toEqual([expect.objectContaining({ userId: "user-1" })]);
  });

  it("classifies the whole reserved prefix as a mention href", () => {
    expect(isMentionHref(mentionHref("user-1"))).toBe(true);
    expect(isMentionHref(`${mentionHref("user-1")}?next=evil`)).toBe(true);
    expect(isMentionHref(`${mentionHref("user-1")}#x`)).toBe(true);
    expect(isMentionHref("https://janosik.invalid/mention/../etc/passwd")).toBe(
      true,
    );
    expect(isMentionHref("https://janosik.invalid/mention%2f..%2fetc")).toBe(
      true,
    );
    expect(isMentionHref("https://janosik.invalid/mention\\..\\etc")).toBe(
      true,
    );
    expect(isMentionHref("https://example.com/mention/user-1")).toBe(false);
    expect(isMentionHref("https://janosik.invalid/mentioning/user-1")).toBe(
      false,
    );
    expect(isMentionHref(null)).toBe(false);
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
    // Preview surfaces also hide a token a code sample keeps inert.
    expect(
      stripMentionMarkup(`Code: \`${mentionMarkdown("Bob", "u2")}\``),
    ).toBe("Code: `@Bob`");
  });

  it("bounds an excerpt and removes HTML so a row stays plain text", () => {
    const text = `<img src=x onerror=alert(1)> ${"word ".repeat(80)}`;
    const excerpt = commentPlainExcerpt(text, 40);

    expect(excerpt.length).toBeLessThanOrEqual(40);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt).not.toContain("<");
  });
});
