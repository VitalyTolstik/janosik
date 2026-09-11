import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { BoardSection } from "@/components/BoardSection";
import { Header } from "@/components/Header";
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
            <MemoryRouter>
              <BoardProvider>
                <Header />
                <BoardSection />
              </BoardProvider>
            </MemoryRouter>
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

    expect(screen.getByText("Empty")).toBeInTheDocument();
  });

  it("renames the board from the header title (click → Enter)", () => {
    renderBoard();

    // The header title is clickable; click it to start editing.
    const title = screen.getByRole("heading", { name: "Product Launch" });
    fireEvent.click(title);
    const input = screen.getByRole("textbox", { name: "Board title" });
    expect(input).toHaveValue("Product Launch");

    fireEvent.change(input, { target: { value: "Launch 2.0" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Editing ends and the new name shows in the header; no duplicate title
    // exists anywhere else on the page.
    expect(
      screen.getByRole("heading", { name: "Launch 2.0" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Launch 2.0")).toHaveLength(1);
    expect(screen.queryByRole("textbox", { name: "Board title" })).toBeNull();
  });

  it("cancels the rename with Escape", () => {
    renderBoard();
    fireEvent.click(screen.getByRole("heading", { name: "Product Launch" }));
    const input = screen.getByRole("textbox", { name: "Board title" });
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(
      screen.getByRole("heading", { name: "Product Launch" }),
    ).toBeInTheDocument();
  });

  it("shows the board name exactly once (header only, not in content)", () => {
    renderBoard();
    expect(screen.getAllByText("Product Launch")).toHaveLength(1);
  });
});
