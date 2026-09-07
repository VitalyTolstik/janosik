import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { BoardSection } from "@/components/BoardSection";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";

/**
 * Render test for the main board: with an empty localStorage the app falls
 * back to the seed board, and the board title, columns and cards are
 * rendered on screen.
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

describe("BoardSection", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the seed board with its columns and cards", () => {
    renderBoard();

    expect(
      screen.getByRole("heading", { name: "Product Launch" }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("heading", { name: "Backlog" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "In Progress" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Done" })).toBeInTheDocument();

    expect(
      screen.getByText("Design the new onboarding flow"),
    ).toBeInTheDocument();
    expect(screen.getByText("Set up CI/CD pipeline")).toBeInTheDocument();
    expect(
      screen.getByText("Write unit tests for the reducer"),
    ).toBeInTheDocument();
  });

  it("shows an empty state when there are no columns", () => {
    const emptyBoard =
      '[{"id":"empty","title":"Empty","columns":[],"cards":{},"labels":[],"createdAt":1,"updatedAt":1}]';
    localStorage.setItem("janosik-boards", emptyBoard);

    renderBoard();

    expect(screen.getByRole("heading", { name: "Empty" })).toBeInTheDocument();
  });
});
