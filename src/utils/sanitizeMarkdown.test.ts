import { describe, expect, it } from "vitest";

import { sanitizeMarkdownForImport } from "./sanitizeMarkdown";

describe("sanitizeMarkdownForImport", () => {
  it("removes HTML img tags that would hit the image plugin innerHTML sink", () => {
    const input = '<img src=x onerror="alert(1)">\n\nsome text';
    const output = sanitizeMarkdownForImport(input);
    expect(output).not.toContain("<img");
    expect(output).not.toContain("onerror");
    expect(output).toContain("some text");
  });

  it("strips tags split across lines (the per-line pass misses them)", () => {
    const input = "before\n<img\n  src=x\n  onerror=\"alert(1)\">\nafter";
    const output = sanitizeMarkdownForImport(input);
    expect(output).toBe("before\n\nafter");
  });

  it("strips comments and generic tags so imports stop failing", () => {
    expect(sanitizeMarkdownForImport("<b>bold</b>")).toBe("bold");
    // The tags go, the literal text between them stays.
    expect(sanitizeMarkdownForImport("<script>alert(1)</script>")).toBe("alert(1)");
  });

  it("leaves normal markdown untouched", () => {
    const md = [
      "# Title",
      "",
      "- item **bold** and `code`",
      "1. numbered",
      "- [x] task",
      "",
      "> quote",
      "",
      "[link](https://example.com)",
      "",
      "---",
    ].join("\n");
    expect(sanitizeMarkdownForImport(md)).toBe(md);
  });

  it("keeps HTML-looking text inside fenced code blocks and inline code", () => {
    const md = 'Text with `<img src=x onerror="alert(1)">` inline.\n\n```html\n<img src=x onerror="alert(1)">\n```\n\nafter';
    expect(sanitizeMarkdownForImport(md)).toBe(md);
  });

  it("keeps math-like comparisons that are not tags", () => {
    expect(sanitizeMarkdownForImport("5 < 6 and 7 > 3")).toBe("5 < 6 and 7 > 3");
  });
});
