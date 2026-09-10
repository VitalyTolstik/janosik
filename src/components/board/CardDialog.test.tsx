import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BoardSection } from "@/components/BoardSection";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";

/**
 * Integration test for the card description editor (MDXEditor): opening a
 * card shows the WYSIWYG editor seeded with the stored markdown; edits are
 * streamed into the board state (and survive a dialog reopen).
 *
 * The real MDXEditor (Lexical) is stubbed — it needs a full browser layout
 * engine; the editor itself is covered by the library's own test suite.
 */

vi.mock("@/components/editor/DescriptionEditor", () => ({
  DescriptionEditor: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (markdown: string) => void;
  }) => (
    <textarea
      aria-label="Description"
      data-testid="description-editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

function renderBoard() {
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <I18nProvider>
          <TooltipProvider>
            <BoardProvider>
              <BoardSection />
            </BoardProvider>
          </TooltipProvider>
        </I18nProvider>
      </BoardBackgroundProvider>
    </ThemeProvider>,
  );
}

async function openCardDialog(title: string) {
  renderBoard();
  fireEvent.click(screen.getByText(title));
  // Radix Dialog renders into a portal — find the dialog content.
  const dialog = await screen.findByRole("dialog");
  return dialog;
}

describe("CardDialog description editor", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("opens with the stored markdown and streams edits into the board", async () => {
    const dialog = await openCardDialog("Design the new onboarding flow");

    // The editor is seeded with the card's markdown.
    const editor = within(dialog).getByLabelText(
      "Description",
    ) as HTMLTextAreaElement;
    expect(editor.value).toContain("**bold**");

    // An edit reaches the board state…
    fireEvent.change(editor, { target: { value: "Updated via MDXEditor" } });
    expect(editor.value).toBe("Updated via MDXEditor");

    // …and survives closing + reopening the dialog.
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.click(screen.getByText("Design the new onboarding flow"));
    const reopened = await screen.findByRole("dialog");
    const editorAgain = within(reopened).getByLabelText(
      "Description",
    ) as HTMLTextAreaElement;
    expect(editorAgain.value).toBe("Updated via MDXEditor");
  });
});
