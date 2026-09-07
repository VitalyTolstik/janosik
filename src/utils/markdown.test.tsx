import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MarkdownView } from "@/utils/markdown";

/**
 * Rendering tests for the MarkdownView component.
 *
 * The renderer must:
 * 1. Turn Markdown into rich elements (bold, italic, code, lists, links,
 *    headings, GFM tables/task lists/strikethrough).
 * 2. NOT execute raw HTML embedded in the text — react-markdown skips raw
 *    HTML by default and renders through React elements (no
 *    dangerouslySetInnerHTML). This is the injection-safety contract from
 *    ROADMAP TASK-1 DoD (JSON import / pasted text are external inputs).
 */
describe("MarkdownView", () => {
  it("renders bold, italic and inline code", () => {
    render(
      <MarkdownView>
        **bold text** and *italic text* and `code text`
      </MarkdownView>,
    );
    expect(screen.getByText("bold text").tagName).toBe("STRONG");
    expect(screen.getByText("italic text").tagName).toBe("EM");
    expect(screen.getByText("code text").tagName).toBe("CODE");
  });

  it("renders lists, links and headings", () => {
    render(
      <MarkdownView>
        {
          "# H1\n\n## H2\n\n### H3\n\n- item one\n- item two\n\n[link to site](https://example.com)"
        }
      </MarkdownView>,
    );
    // Heading levels map to real elements…
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "H1",
    );
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "H2",
    );
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(
      "H3",
    );
    // …with a visible size ladder (h1 > h2 > h3) — not all the same size.
    const h1Class = screen.getByRole("heading", { level: 1 }).className;
    const h2Class = screen.getByRole("heading", { level: 2 }).className;
    const h3Class = screen.getByRole("heading", { level: 3 }).className;
    expect(h1Class).toContain("text-xl");
    expect(h2Class).toContain("text-lg");
    expect(h3Class).toContain("text-base");
    expect(
      h1Class.includes("text-xl") &&
        h2Class.includes("text-lg") &&
        h3Class.includes("text-base"),
    ).toBe(true);
    expect(screen.getByText("item one")).toBeInTheDocument();
    expect(screen.getByText("item two")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "link to site" });
    expect(link).toHaveAttribute("href", "https://example.com");
    // External links open in a new tab and are safe from reverse-tabnabbing.
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders GFM task lists, tables and strikethrough", () => {
    render(
      <MarkdownView>
        {
          "- [x] done item\n- [ ] todo item\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n~~old~~"
        }
      </MarkdownView>,
    );
    // Two checkboxes: one checked, one unchecked.
    const checks = screen.getAllByRole("checkbox");
    expect(checks).toHaveLength(2);
    expect(checks[0]).toBeChecked();
    expect(checks[1]).not.toBeChecked();
    expect(screen.getByRole("table")).toHaveTextContent("1");
    expect(screen.getByText("old").tagName).toBe("DEL");
  });

  it("renders a code block", () => {
    render(<MarkdownView>{"```\nconst x = 1;\n```"}</MarkdownView>);
    const code = document.querySelector("pre code");
    expect(code).not.toBeNull();
    expect(code).toHaveTextContent("const x = 1;");
  });

  it("does not execute raw HTML (script injection is inert)", () => {
    const { container } = render(
      <MarkdownView>
        {"Hello <script>window.pwned = true</script>"}
      </MarkdownView>,
    );
    // No script element may reach the DOM.
    expect(container.querySelector("script")).toBeNull();
    // ... and the dangerous text is not rendered as HTML.
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
    // The preview wrapper clamps to ⇐2 lines.
    const wrapper = document.querySelector(".line-clamp-2");
    expect(wrapper).not.toBeNull();
    expect(wrapper).toHaveTextContent("Bold snippet");
  });
});
