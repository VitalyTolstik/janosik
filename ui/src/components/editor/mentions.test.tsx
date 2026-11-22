import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { mentionMarkdown } from "@janosik/shared";

import { CommentBody } from "./CommentEditor";

// Lexical needs these when it commits a selection in jsdom.
if (typeof Range !== "undefined") {
  const zeroRect = (): DOMRect =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
    }) as DOMRect;
  Range.prototype.getBoundingClientRect ??= zeroRect;
  Range.prototype.getClientRects ??= () =>
    ({ length: 0, item: () => null }) as unknown as DOMRectList;
}

describe("comment mention rendering (TASK-177.12)", () => {
  it("renders an explicit mention as an internal profile link", async () => {
    const text = `Ping ${mentionMarkdown("Alice", "user-1")} please`;

    render(<CommentBody text={text} />);

    await waitFor(() => {
      const anchor = document.querySelector(
        '.janosik-md-content a[href="https://janosik.invalid/mention/user-1"]',
      );
      expect(anchor).not.toBeNull();
      expect(anchor).toHaveTextContent("@Alice");
    });
  });

  it("does not execute or render raw HTML around a mention", async () => {
    const text = `${mentionMarkdown("Bob", "user-2")} <img src=x onerror="alert(1)"><script>alert(2)</script>`;

    render(<CommentBody text={text} />);

    await waitFor(() => {
      expect(document.querySelector(".janosik-md-content")).toHaveTextContent(
        "@Bob",
      );
    });
    expect(document.querySelector(".janosik-md-content img")).toBeNull();
    expect(document.querySelector(".janosik-md-content script")).toBeNull();
  });
});
