import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BoardSection } from "@/components/BoardSection";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";

vi.mock("@/components/board/saved-views-loader", () => ({
  loadSavedViewsMenu: () =>
    Promise.reject(new Error("saved views chunk unavailable")),
}));

function renderBoard() {
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <ToastProvider>
              <TooltipProvider>
                <MemoryRouter initialEntries={["/"]}>
                  <BoardProvider>
                    <BoardSection />
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

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("saved views chunk failure", () => {
  it("keeps the board usable and shows only the reserved placeholder", async () => {
    // React reports a caught lazy-chunk error to console/reportError; the
    // assertion is the visible fallback, not the log line.
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("reportError", vi.fn());
    renderBoard();

    expect(
      await screen.findByText("Design the new onboarding flow"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("filter-bar")).toBeInTheDocument();

    const placeholder = await screen.findByTestId(
      "saved-views-menu-placeholder",
    );
    // Same footprint as the trigger (36 px, 44 px below lg); the FilterBar
    // does not shift and the rest of the board stays interactive.
    expect(placeholder).toHaveClass(
      "h-9",
      "w-9",
      "shrink-0",
      "max-lg:h-11",
      "max-lg:w-11",
    );
    expect(screen.queryByTestId("saved-views-menu")).not.toBeInTheDocument();
    expect(screen.queryByTestId("error-compact")).not.toBeInTheDocument();
  });
});
