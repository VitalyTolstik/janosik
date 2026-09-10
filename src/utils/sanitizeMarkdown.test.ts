import { fromMarkdown } from "mdast-util-from-markdown";
import { describe, expect, it } from "vitest";

import { sanitizeMarkdownForImport } from "./sanitizeMarkdown";

/** The actual security property: after sanitization the real remark parser
 * (the one mdxeditor feeds into the image plugin's innerHTML sink) must
 * not see a single `html` node — at any depth, block or inline. */
function htmlNodes(markdown: string): string[] {
  const found: string[] = [];
  const visit = (node: { type: string; value?: string; children?: unknown[] }) => {
    if (node.type === "html") found.push(node.value ?? "");
    node.children?.forEach((child) => visit(child as never));
  };
  visit(fromMarkdown(markdown) as never);
  return found;
}

function expectNoHtml(markdown: string) {
  const sanitized = sanitizeMarkdownForImport(markdown);
  expect(htmlNodes(sanitized), `sanitized: ${JSON.stringify(sanitized)}`).toEqual([]);
  return sanitized;
}

describe("sanitizeMarkdownForImport", () => {
  it("removes HTML img tags that would hit the image plugin innerHTML sink", () => {
    const sanitized = expectNoHtml('<img src=x onerror="alert(1)">\n\nsome text');
    expect(sanitized).toContain("some text");
    expect(sanitized).not.toContain("onerror");
  });

  it("strips tags split across lines (the per-line pass misses them)", () => {
    expect(expectNoHtml('before\n<img\n  src=x\n  onerror="alert(1)">\nafter')).toBe(
      "before\n\nafter",
    );
  });

  it("strips comments and generic tags so imports stop failing", () => {
    expect(expectNoHtml("<b>bold</b>")).toBe("bold");
    // The tags go, the literal text between them stays.
    expect(expectNoHtml("<script>alert(1)</script>")).toBe("alert(1)");
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
    expect(expectNoHtml(md)).toBe(md);
  });

  it("keeps HTML-looking text inside fenced code blocks", () => {
    const md = '```html\n<img src=x onerror="alert(1)">\n```\n\nafter';
    expect(expectNoHtml(md)).toBe(md);
  });

  it("strips HTML inside inline code (fail-safe: pairing edge cases must not shield tags)", () => {
    expect(expectNoHtml("a `<img src=x onerror=alert(1)>` b")).toBe("a `` b");
  });

  it("keeps math-like comparisons that are not tags", () => {
    expect(expectNoHtml("5 < 6 and 7 > 3")).toBe("5 < 6 and 7 > 3");
  });

  // --- Bypass regression cases (each produced html nodes in an earlier
  // version of the sanitizer) ---

  it("bypass: backtick fence with a backtick in the info string is not a fence", () => {
    // Naive fence tracking treated "```<img ...>" as a fence opener and
    // shielded the tag; remark parses it as a paragraph with inline HTML.
    expectNoHtml("```<img src=x onerror=alert(1)>`z");
    expectNoHtml("```js` <img src=x onerror=alert(1)>\ntext");
    expectNoHtml("``` a`b\n<img src=x onerror=alert(1)>\n```");
  });

  it("bypass: inline backtick runs pair by equal length, not greedily", () => {
    // A naive "first backtick closes first" pairing protects the tag here,
    // while remark sees an unclosed triple-backtick run and raw HTML.
    expectNoHtml("```<img src=x onerror=alert(1)>`z");
    expectNoHtml("`` <img src=x onerror=alert(1)> ` z");
    expectNoHtml("x `y``<img src=x onerror=alert(1)>`z");
  });

  it("bypass: escaped backticks do not open code spans", () => {
    expectNoHtml("\\` <img src=x onerror=alert(1)> ` z");
  });

  it("bypass: HTML block continuations and unterminated fences", () => {
    expectNoHtml("<div>\n```\n<img src=x onerror=alert(1)>\n```");
    expectNoHtml("```\n<img src=x onerror=alert(1)>");
    expectNoHtml("text\n    <img src=x onerror=alert(1)>");
  });

  it("bypass: stripping tags between backtick runs must not unpair code spans", () => {
    // Found by fuzz: removing "<b><script>" merges the 4-run with the
    // 1-run into a 5-run, unpairing the span that shielded the img.
    // The sanitizer iterates to a fixpoint so the tag goes too.
    expect(expectNoHtml("````<b><script>`<img src=x onerror=alert(1)>`")).toBe(
      "``````",
    );
  });

  it("differential fuzz: no adversarial combination leaves an html node", () => {
    const fragments = [
      "`", "``", "```", "````", "~~~",
      "<img src=x onerror=alert(1)>", "<b>", "</b>", "<script>",
      "\\`", "a", " ", "x`y", "\n", "~~~ ts",
    ];
    // Deterministic sweep over a fixed sample of combinations (seeded).
    let seed = 1337;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let i = 0; i < 10000; i++) {
      const parts: string[] = [];
      const count = 2 + rand(6);
      for (let j = 0; j < count; j++) parts.push(fragments[rand(fragments.length)]);
      const input = parts.join("");
      const sanitized = sanitizeMarkdownForImport(input);
      expect(htmlNodes(sanitized), `input: ${JSON.stringify(input)}`).toEqual([]);
    }
  });
});
