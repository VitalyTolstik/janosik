import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { BoardSection } from "@/components/BoardSection";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";

/**
 * Integration test for the card description editor: opening a card shows an
 * editable Markdown textarea; the «Preview» toggle renders it as formatted
 * Markdown (bold, task list) and «Edit» brings the textarea back.
 */

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

describe("CardDialog Markdown toggle", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("opens with the textarea and the hint, and preview renders Markdown", async () => {
    const dialog = await openCardDialog("Design the new onboarding flow");

    // The description textarea is in edit mode by default.
    const textarea = within(dialog).getByLabelText(
      "Description",
    ) as HTMLTextAreaElement;
    expect(textarea).toBeInTheDocument();
    expect(textarea.value).toContain("**tooltips**");
    expect(
      within(dialog).getByText("Markdown supported"),
    ).toBeInTheDocument();

    // Switch to preview → formatted bold + a checked task item.
    fireEvent.click(within(dialog).getByRole("button", { name: "Preview" }));
    expect(textarea).not.toBeInTheDocument();
    const bold = within(dialog).getByText("tooltips");
    expect(bold.tagName).toBe("STRONG");
    const checks = within(dialog).getAllByRole("checkbox");
    expect(checks).toHaveLength(2);
    expect(checks[0]).toBeChecked();
    expect(checks[1]).not.toBeChecked();

    // Back to edit → the live textarea is there again with same content.
    fireEvent.click(within(dialog).getByRole("button", { name: "Edit" }));
    const textareaAgain = within(dialog).getByLabelText(
      "Description",
    ) as HTMLTextAreaElement;
    expect(textareaAgain.value).toContain("**tooltips**");
  });
});
