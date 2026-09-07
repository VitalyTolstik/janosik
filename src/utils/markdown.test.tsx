import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MarkdownView } from "@/utils/markdown";

/**
 * Rendering tests for the MarkdownView component — a full matrix of the
 * CommonMark + GFM features the card description supports:
 *
 * Headings (h1–h6) · bold · italic · strikethrough · inline code · code
 * blocks · links (+ GFM autolinks) · images · bullet/numbered/nested lists ·
 * task lists · tables · blockquotes · horizontal rules · escaping.
 *
 * The renderer must NOT execute raw HTML embedded in the text — react-markdown
 * skips raw HTML by default, renders through React elements (no
 * dangerouslySetInnerHTML) and filters `javascript:`/`vbscript:` URLs. This is
 * the injection-safety contract from ROADMAP TASK-1 DoD (JSON import / pasted
 * text are external inputs).
 */
describe("MarkdownView", () => {
  it("renders bold, italic, strikethrough and inline code", () => {
    render(
      <MarkdownView>
        **bold** *italic* ~~struck~~ `code` and plain text
      </MarkdownView>,
    );
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("italic").tagName).toBe("EM");
    expect(screen.getByText("struck").tagName).toBe("DEL");
    expect(screen.getByText("code").tagName).toBe("CODE");
  });

  it("renders all six heading levels with a size ladder", () => {
    render(
      <MarkdownView>
        {"# H1\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6"}
      </MarkdownView>,
    );
    for (const level of [1, 2, 3, 4, 5, 6]) {
      expect(screen.getByRole("heading", { level }).textContent).toBe(
        `H${level}`,
      );
    }
    // Visible size ladder — the classes must strictly decrease.
    const sizeOf = (level: number) =>
      screen.getByRole("heading", { level }).className;
    const sizes = [1, 2, 3, 4, 5, 6].map(sizeOf);
    expect(sizes[0]).toContain("text-xl");
    expect(sizes[1]).toContain("text-lg");
    expect(sizes[2]).toContain("text-base");
    expect(sizes[3]).toContain("text-sm");
    expect(sizes[4]).toContain("text-[13px]");
    expect(sizes[5]).toContain("text-xs");
  });

  it("renders bullet, numbered and nested lists", () => {
    render(
      <MarkdownView>
        {"- alpha\n- beta\n\n1. one\n2. two\n   - nested a\n   - nested b"}
      </MarkdownView>,
    );
    expect(screen.getByText("alpha").tagName).toBe("LI");
    expect(screen.getByText("beta").tagName).toBe("LI");
    // One numbered <ol>, one nested bullet <ul> inside it.
    expect(document.querySelector("ol")?.tagName).toBe("OL");
    expect(document.querySelector("ul")?.tagName).toBe("UL");
    expect(screen.getByText("nested a").tagName).toBe("LI");
    expect(screen.getByText("nested b").tagName).toBe("LI");
  });

  it("renders links and GFM autolinks", () => {
    render(
      <MarkdownView>
        {
          "[linked](https://example.com) and bare https://auto.example/x and <mailto:a@b.c>"
        }
      </MarkdownView>,
    );
    const linked = screen.getByRole("link", { name: "linked" });
    expect(linked).toHaveAttribute("href", "https://example.com");
    expect(linked).toHaveAttribute("target", "_blank");
    expect(linked).toHaveAttribute("rel", "noopener noreferrer");

    const auto = screen.getByText("https://auto.example/x");
    expect(auto.tagName).toBe("A");
    expect(auto).toHaveAttribute("href", "https://auto.example/x");
  });

  it("renders inline code and fenced code blocks", () => {
    render(
      <MarkdownView>
        {"before `inline()` after\n\n```ts\nconst x = 1;\n```"}
      </MarkdownView>,
    );
    expect(screen.getByText("inline()").tagName).toBe("CODE");
    const block = document.querySelector("pre code");
    expect(block).not.toBeNull();
    expect(block).toHaveTextContent("const x = 1;");
  });

  it("renders images with alt, and blocks javascript: image URLs", () => {
    const { container } = render(
      <MarkdownView>
        {"![Logo](https://example.com/logo.png)\n\n![Bad](javascript:alert(1))"}
      </MarkdownView>,
    );
    const imgs = container.querySelectorAll("img");
    // The safe image renders with src and alt…
    const safe = screen.getByRole("img", { name: "Logo" });
    expect(safe).toHaveAttribute("src", "https://example.com/logo.png");
    // …the javascript: one must not be an active <img src=javascript:>.
    expect(container.querySelector('img[src^="javascript:"]')).toBeNull();
    expect(imgs.length).toBeGreaterThanOrEqual(1);
  });

  it("renders GFM task lists, tables, blockquote and hr", () => {
    render(
      <MarkdownView>
        {
          "- [x] done\n- [ ] todo\n\n> quoted line\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n---"
        }
      </MarkdownView>,
    );
    const checks = screen.getAllByRole("checkbox");
    expect(checks).toHaveLength(2);
    expect(checks[0]).toBeChecked();
    expect(checks[1]).not.toBeChecked();
    expect(screen.getByRole("blockquote")).toHaveTextContent("quoted line");
    expect(screen.getByRole("table")).toHaveTextContent("1");
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  it("escapes markdown syntax when backslash-prefixed", () => {
    render(<MarkdownView>{"\\*not italic\\*"}</MarkdownView>);
    // Backslash is consumed by CommonMark: the literal asterisks stay as
    // plain text inside a <p> — never a STRONG.
    const literal = screen.getByText("*not italic*");
    expect(literal.tagName).toBe("P");

    const { container } = render(
      <MarkdownView>{"\\`not code\\`"}</MarkdownView>,
    );
    expect(container.textContent).toBe("`not code`");
    expect(container.querySelector("code")).toBeNull();
  });

  it("does not execute raw HTML (script injection is inert)", () => {
    const { container } = render(
      <MarkdownView>
        {"Hello <script>window.pwned = true</script>"}
      </MarkdownView>,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(screen.queryByText("window.pwned = true")).toBeNull();
  });

  it("does not render <img onerror> as an active image", () => {
    const { container } = render(
      <MarkdownView>{"<img src=x onerror=alert(1)>"}</MarkdownView>,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
  });

  it("renders safely in preview mode (snippet)", () => {
    render(<MarkdownView preview>**Bold** snippet</MarkdownView>);
    expect(screen.getByText("Bold").tagName).toBe("STRONG");
    const wrapper = document.querySelector(".line-clamp-2");
    expect(wrapper).not.toBeNull();
    expect(wrapper).toHaveTextContent("Bold snippet");
  });

  it("keeps a heading size ladder and block layout in preview mode", () => {
    render(
      <MarkdownView preview>{"# Big title\n\n## Smaller\n\nplain paragraph"}</MarkdownView>,
    );
    // Headings stay real headings in the snippet…
    expect(
      screen.getByRole("heading", { level: 1 }),
    ).toHaveTextContent("Big title");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "Smaller",
    );
    // …and the compact ladder keeps them visibly different sizes.
    const h1Class = screen.getByRole("heading", { level: 1 }).className;
    const h2Class = screen.getByRole("heading", { level: 2 }).className;
    expect(h1Class).toContain("text-sm");
    expect(h2Class).toContain("text-[13px]");
    // Blocks are not flattened to inline — the paragraph is a <p>.
    const para = screen.getByText("plain paragraph");
    expect(para.tagName).toBe("P");
  });

  it("renders an image as an inline alt placeholder in preview mode", () => {
    render(
      <MarkdownView preview>
        {"![Cover](https://example.com/cover.jpg)"}
      </MarkdownView>,
    );
    // No <img> in the card snippet — just a compact placeholder, so the
    // 2-line clamp can't be blown up by a large image.
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("🖼 Cover")).toBeInTheDocument();
  });
});
