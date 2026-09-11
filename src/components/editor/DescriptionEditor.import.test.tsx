/**
 * TASK-21 — regression tests for the real (unmocked) MDXEditor import path.
 *
 * The seed card "Design the new onboarding flow" ships a rich markdown
 * document (headings, nested lists, checklist, ```ts code block, quote,
 * thematic break, table, image). In the browser this document silently
 * truncated at the code block: the tail (quote/---/table/image) never
 * rendered AND the editor's onChange died completely (edits not saved).
 *
 * These tests render the real editor in jsdom to catch that class of
 * failure — CardDialog.test.tsx mocks DescriptionEditor and can't see it.
 */
import { render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DescriptionEditor } from "./DescriptionEditor";
import { SEED_RICH_MARKDOWN } from "./seed-md";

// jsdom doesn't implement Range.getBoundingClientRect/ClientRects — Lexical
// needs them when it commits DOM selection updates after edits.
if (typeof Range !== "undefined") {
  const zeroRect = (): DOMRect =>
    ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }) as DOMRect;
  Range.prototype.getBoundingClientRect ??= zeroRect;
  Range.prototype.getClientRects ??= () =>
    ({ length: 0, item: () => null } as unknown as DOMRectList);
}

/** The exact seed markdown of card-1 (seed-data.ts). */
function renderEditor(markdown: string) {
  const onChange = vi.fn();
  render(
    <DescriptionEditor
      value={markdown}
      onChange={onChange}
      placeholder="test"
    />,
  );
  return onChange;
}

describe("DescriptionEditor — real MDXEditor import (TASK-21)", () => {
  it("imports the full seed document — no truncation at the code block", async () => {
    renderEditor(SEED_RICH_MARKDOWN);

    await waitFor(
      () => {
        const content = document.querySelector(".janosik-md-content");
        expect(content).not.toBeNull();
        // Tail constructs after the ```ts code block must all survive.
        expect(content?.textContent).toContain("Quote: keep the first run");
        expect(content?.textContent).toContain("Step");
        expect(content?.textContent).toContain("Intro copy");
      },
      { timeout: 5000 },
    );
  });

  it("stays editable after importing the rich document — onChange fires", async () => {
    const onChange = renderEditor(SEED_RICH_MARKDOWN);
    const user = userEvent.setup();

    const editable = await waitFor(
      () => {
        const el = document.querySelector<HTMLElement>(
          ".janosik-md-content[contenteditable]",
        );
        expect(el).not.toBeNull();
        return el!;
      },
      { timeout: 5000 },
    );

    await user.type(editable, "X");

    await waitFor(
      () => {
        expect(onChange).toHaveBeenCalled();
      },
      { timeout: 5000 },
    );
    // The keystroke must survive the export: the emitted markdown contains it.
    const emitted = onChange.mock.lastCall?.[0] as string;
    expect(emitted).toContain("X");
  });
});
