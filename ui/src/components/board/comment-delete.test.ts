import { describe, expect, it } from "vitest";

import {
  commentAuthorLabel,
  commentExcerpt,
  DELETE_EXCERPT_LENGTH,
} from "@/components/board/comment-delete";

describe("commentExcerpt", () => {
  it("collapses multi-line whitespace to one line", () => {
    expect(commentExcerpt("  Rename the\nmigration\t table  ")).toBe(
      "Rename the migration table",
    );
  });

  it("keeps exactly the 240-character limit intact", () => {
    const text = "a".repeat(DELETE_EXCERPT_LENGTH);
    expect(commentExcerpt(text)).toBe(text);
  });

  it("cuts one character past the limit to 239 characters plus an ellipsis", () => {
    const text = "a".repeat(DELETE_EXCERPT_LENGTH + 1);
    expect(commentExcerpt(text)).toBe(`${"a".repeat(239)}…`);
  });

  it("never splits a surrogate pair at the cut (238 chars + emoji + tail)", () => {
    const prefix = "a".repeat(238);
    const excerpt = commentExcerpt(`${prefix}😀tail`);

    // The emoji is the last kept code point, followed by the ellipsis.
    expect(excerpt).toBe(`${prefix}😀…`);
    expect(Array.from(excerpt)).toHaveLength(DELETE_EXCERPT_LENGTH);
    expect(excerpt).not.toContain("\uFFFD");
    expect(
      Array.from(excerpt).some((char) => {
        const code = char.codePointAt(0) ?? 0;
        return code >= 0xd800 && code <= 0xdfff;
      }),
    ).toBe(false);
  });

  it("keeps markdown and code text as collapsed plain text", () => {
    expect(
      commentExcerpt("**Bold** and `code`\n\n```ts\nconst x = 1;\n```"),
    ).toBe("**Bold** and `code` ```ts const x = 1; ```");
  });
});

describe("commentAuthorLabel", () => {
  const currentUser = {
    id: "user-1",
    displayName: "Admin",
    email: "admin@example.com",
  };

  it("prefers a distinct board member display name", () => {
    expect(
      commentAuthorLabel(
        "user-1",
        { displayName: "Vera", email: "vera@example.com" },
        currentUser,
        "Unknown author",
      ),
    ).toBe("Vera");
  });

  it("falls back to the member email when no display name is set", () => {
    expect(
      commentAuthorLabel(
        "user-1",
        { displayName: null, email: "vera@example.com" },
        currentUser,
        "Unknown author",
      ),
    ).toBe("vera@example.com");
  });

  it("falls back to the current user when the directory is missing", () => {
    expect(
      commentAuthorLabel("user-1", undefined, currentUser, "Unknown author"),
    ).toBe("Admin");
  });

  it("falls back to the author id when no profile matches", () => {
    expect(
      commentAuthorLabel("user-9", undefined, currentUser, "Unknown author"),
    ).toBe("user-9");
  });

  it("uses the unknown-author copy when even the id is empty", () => {
    expect(commentAuthorLabel("", undefined, undefined, "Unknown author")).toBe(
      "Unknown author",
    );
  });
});
