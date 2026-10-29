import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BoardSection } from "@/components/BoardSection";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";

/**
 * TASK-156 review: the compact error boundary around the card dialog can
 * now be closed by the user. BoardSection's `onReset` must close the card
 * and clear its `?card=` deep link, so the boundary remounts a closed
 * dialog instead of the same crash — and stays healthy for the next card.
 *
 * The real CardDialog is replaced by a stub that crashes for one specific
 * card; the dialog itself has its own integration tests elsewhere.
 */

vi.mock("@/components/board/CardDialog", () => ({
  CardDialog: ({ cardId, open }: { cardId: string | null; open: boolean }) => {
    if (open && cardId === "card-broken") {
      throw new Error("boom");
    }
    return <div data-testid="card-dialog-stub">{cardId ?? "closed"}</div>;
  },
}));

/** Exposes the current URL query. */
function RouteProbe() {
  const location = useLocation();
  return <span data-testid="route-probe">{location.search}</span>;
}

function seedBoard(): void {
  localStorage.setItem(
    "janosik-boards",
    JSON.stringify([
      {
        id: "b-1",
        title: "Reset",
        columns: [
          {
            id: "col-1",
            title: "To do",
            cardIds: ["card-broken", "card-fine"],
            createdAt: 1,
          },
        ],
        cards: {
          "card-broken": {
            id: "card-broken",
            title: "Broken card",
            labelIds: [],
            createdAt: 1,
            updatedAt: 1,
          },
          "card-fine": {
            id: "card-fine",
            title: "Fine card",
            labelIds: [],
            createdAt: 1,
            updatedAt: 1,
          },
        },
        labels: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ]),
  );
}

function renderBoard() {
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <ToastProvider>
              <TooltipProvider>
                <MemoryRouter initialEntries={["/board/b-1"]}>
                  <BoardProvider>
                    <BoardSection />
                    <RouteProbe />
                  </BoardProvider>
                </MemoryRouter>
              </TooltipProvider>
            </ToastProvider>
          </I18nProvider>
        </BoardGlassProvider>
      </BoardBackgroundProvider>
    </ThemeProvider>,
  );
}

describe("BoardSection compact boundary reset (TASK-156 review)", () => {
  beforeEach(() => {
    localStorage.clear();
    seedBoard();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("closes the crashed card and clears its deep link on reset", () => {
    renderBoard();

    // Opening the broken card crashes inside the contained boundary.
    fireEvent.click(screen.getByText("Broken card"));
    expect(screen.getByTestId("error-compact")).toBeInTheDocument();
    expect(screen.getByTestId("route-probe").textContent).toBe(
      "?card=card-broken",
    );

    // Close: the fallback resets, the card closes and the deep link goes.
    fireEvent.click(screen.getByTestId("error-compact-close"));
    expect(screen.queryByTestId("error-compact")).toBeNull();
    expect(screen.getByTestId("card-dialog-stub").textContent).toBe("closed");
    expect(screen.getByTestId("route-probe").textContent).toBe("");

    // The boundary is healthy for the next card.
    fireEvent.click(screen.getByText("Fine card"));
    expect(screen.getByTestId("card-dialog-stub").textContent).toBe(
      "card-fine",
    );
    expect(screen.queryByTestId("error-compact")).toBeNull();
  });
});
