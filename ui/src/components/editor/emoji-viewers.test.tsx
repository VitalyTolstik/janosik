/**
 * Emoji support (owner request) on the real, unmocked MDXEditor viewers:
 * shortcodes and ASCII emoticons in stored markdown render as emoji in
 * the comment body and the read-only description. Code spans are left
 * alone (unit-level guarantee in emoji.test.ts).
 */
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CommentBody } from "./CommentEditor";
import { DescriptionEditor } from "./DescriptionEditor";

// jsdom doesn't implement Range.getBoundingClientRect/ClientRects — Lexical
// needs them when it commits DOM selection updates after edits.
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

describe("emoji in markdown viewers", () => {
  it("renders shortcodes and emoticons in a comment body", async () => {
    render(<CommentBody text="ship it :rocket: great job :+1: :)" />);
    await waitFor(() => {
      expect(document.querySelector(".janosik-md-content")).toHaveTextContent(
        "🚀",
      );
    });
    const content = document.querySelector(".janosik-md-content");
    expect(content).toHaveTextContent("👍");
    expect(content).toHaveTextContent("🙂");
    expect(content).not.toHaveTextContent(":rocket:");
  });

  it("renders emoji in the read-only description but keeps raw markdown editable", async () => {
    const { unmount } = render(
      <DescriptionEditor
        value=":fire: hot https://example.com"
        onChange={() => {}}
        placeholder="test"
        readOnly
      />,
    );
    await waitFor(() => {
      expect(document.querySelector(".janosik-md-content")).toHaveTextContent(
        "🔥",
      );
    });
    expect(document.querySelector(".janosik-md-content")).not.toHaveTextContent(
      ":fire:",
    );
    unmount();

    // The editing surface keeps the raw shortcode so edits round-trip.
    render(
      <DescriptionEditor
        value=":fire: hot"
        onChange={() => {}}
        placeholder="test"
      />,
    );
    await waitFor(() => {
      expect(document.querySelector(".janosik-md-content")).toHaveTextContent(
        ":fire:",
      );
    });
    expect(document.querySelector(".janosik-md-content")).not.toHaveTextContent(
      "🔥",
    );
  });
});
