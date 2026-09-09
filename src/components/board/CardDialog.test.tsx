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
 * editable plain-text textarea for the description.
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

describe("CardDialog description editor", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows a plain-text textarea for the description", async () => {
    const dialog = await openCardDialog("Design the new onboarding flow");

    // The description textarea is present and editable as plain text.
    const textarea = within(dialog).getByLabelText(
      "Description",
    ) as HTMLTextAreaElement;
    expect(textarea).toBeInTheDocument();
    expect(textarea.value).toContain("**bold**");

    // The description remains editable as plain text.
    fireEvent.change(textarea, { target: { value: "New plain description" } });
    expect(textarea.value).toBe("New plain description");
  });
});
